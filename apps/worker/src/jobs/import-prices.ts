import type { Sql } from "postgres";

import {
  fetchAllPricesToday,
  mapAllPricesTodayToImportedPrices,
  MtgJsonPriceValidationError,
  MtgJsonPriceProvider,
} from "../integrations/mtgjson/prices.js";
import type { ImportedPrice } from "../integrations/pricing/types.js";

const SOURCE_CODE = "mtgjson";
const SOURCE_NAME = "MTGJSON AllPricesToday";

export type ImportPricesResult = {
  runId: string;
  status: "succeeded" | "failed";
  rawRowCount: number;
  mappedRowCount: number;
  unmappedRowCount: number;
};

// Groups the adapter's flat ImportedPrice[] back by sourceProductId so
// exactly one staging row lands per distinct provider product id (mirroring
// the catalogue importer's "one raw row per external id" convention), and
// so the mapping step below resolves a card_identifiers lookup once per
// product instead of once per provider/finish/list-type combination.
export function groupImportedPricesByProduct(
  prices: ImportedPrice[],
): Map<string, ImportedPrice[]> {
  const grouped = new Map<string, ImportedPrice[]>();
  for (const price of prices) {
    const existing = grouped.get(price.sourceProductId);
    if (existing) {
      existing.push(price);
    } else {
      grouped.set(price.sourceProductId, [price]);
    }
  }
  return grouped;
}

// Resumable per the same convention as importSet() (backlog B-040/B-151):
// keyed by (price_source_id, source_ref) where source_ref is today's date,
// so re-running after a crash reuses the run and skips products already
// snapshotted instead of re-fetching and re-inserting. Uses the MTGJSON
// adapter's lower-level fetch/map functions directly rather than the
// generic PricingProvider interface -- the generic interface returns
// already-normalised ImportedPrice[], but B-151 requires the raw
// per-product payload to be staged *before* mapping, which only the
// concrete adapter's raw response can provide.
export async function importMtgJsonPrices(sql: Sql): Promise<ImportPricesResult> {
  const sourceRef = `daily:${new Date().toISOString().slice(0, 10)}`;

  // Check provider health before starting import (B-154)
  const provider = new MtgJsonPriceProvider();
  const health = await provider.healthCheck();

  const [source] = await sql<{ id: string }[]>`
    insert into price_sources (code, name)
    values (${SOURCE_CODE}, ${SOURCE_NAME})
    on conflict (code) do update set name = excluded.name
    returning id
  `;

  const [run] = await sql<{ id: string; status: string }[]>`
    insert into price_import_runs (price_source_id, source_ref, provider_healthy, provider_health_message)
    values (${source.id}, ${sourceRef}, ${health.healthy}, ${health.message ?? null})
    on conflict (price_source_id, source_ref) do update set provider_healthy = excluded.provider_healthy, provider_health_message = excluded.provider_health_message
    returning id, status
  `;

  if (run.status === "succeeded") {
    return {
      runId: run.id,
      status: "succeeded",
      rawRowCount: 0,
      mappedRowCount: 0,
      unmappedRowCount: 0,
    };
  }

  try {
    const response = await fetchAllPricesToday();
    const prices = mapAllPricesTodayToImportedPrices(response);
    const grouped = groupImportedPricesByProduct(prices);

    const stagingRows = [...grouped.entries()].map(([sourceProductId, productPrices]) => ({
      price_import_run_id: run.id,
      external_id: sourceProductId,
      raw: sql.json(productPrices),
    }));

    if (stagingRows.length > 0) {
      await sql`
        insert into price_staging_rows ${sql(stagingRows, "price_import_run_id", "external_id", "raw")}
        on conflict (price_import_run_id, external_id) do nothing
      `;
    }

    const alreadySnapshotted = new Set(
      (
        await sql<{ source_product_id: string }[]>`
          select distinct source_product_id from price_snapshots where price_import_run_id = ${run.id}
        `
      ).map((row) => row.source_product_id),
    );

    for (const [sourceProductId, productPrices] of grouped) {
      if (alreadySnapshotted.has(sourceProductId)) continue;

      const [identifier] = await sql<{ card_printing_id: string }[]>`
        select card_printing_id from card_identifiers where mtgjson_uuid = ${sourceProductId}
      `;

      if (!identifier) {
        await sql`
          insert into price_import_errors (price_import_run_id, severity, message, context)
          values (
            ${run.id}, 'warning', 'no card_identifiers match for mtgjson uuid',
            ${sql.json({ sourceProductId })}
          )
        `;
        continue;
      }

      const snapshotRows = productPrices.map((price) => ({
        price_import_run_id: run.id,
        price_source_id: source.id,
        provider: price.provider,
        source_product_id: price.sourceProductId,
        source_sku_id: price.sourceSkuId ?? null,
        card_printing_id: identifier.card_printing_id,
        scryfall_id: price.scryfallId ?? null,
        set_code: price.setCode ?? null,
        collector_number: price.collectorNumber ?? null,
        language: price.language,
        finish: price.finish,
        condition: price.condition ?? null,
        price_type: price.priceType,
        amount: price.amount,
        currency: price.currency,
        observed_at: price.observedAt,
      }));

      await sql`
        insert into price_snapshots ${sql(
          snapshotRows,
          "price_import_run_id",
          "price_source_id",
          "provider",
          "source_product_id",
          "source_sku_id",
          "card_printing_id",
          "scryfall_id",
          "set_code",
          "collector_number",
          "language",
          "finish",
          "condition",
          "price_type",
          "amount",
          "currency",
          "observed_at",
        )}
      `;
    }

    const [{ mapped_count: mappedCount }] = await sql<{ mapped_count: string }[]>`
      select count(distinct source_product_id)::text as mapped_count
      from price_snapshots where price_import_run_id = ${run.id}
    `;
    const [{ unmapped_count: unmappedCount }] = await sql<{ unmapped_count: string }[]>`
      select count(*)::text as unmapped_count
      from price_import_errors where price_import_run_id = ${run.id}
    `;

    await sql`
      update price_import_runs
      set status = 'succeeded', completed_at = now(),
          raw_row_count = ${grouped.size},
          mapped_row_count = ${Number(mappedCount)},
          unmapped_row_count = ${Number(unmappedCount)}
      where id = ${run.id}
    `;

    return {
      runId: run.id,
      status: "succeeded",
      rawRowCount: grouped.size,
      mappedRowCount: Number(mappedCount),
      unmappedRowCount: Number(unmappedCount),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await sql`
      insert into price_import_errors (price_import_run_id, severity, message)
      values (${run.id}, 'error', ${message})
    `;
    await sql`
      update price_import_runs set status = 'failed', completed_at = now() where id = ${run.id}
    `;

    if (error instanceof MtgJsonPriceValidationError) {
      return {
        runId: run.id,
        status: "failed",
        rawRowCount: 0,
        mappedRowCount: 0,
        unmappedRowCount: 0,
      };
    }

    throw error;
  }
}
