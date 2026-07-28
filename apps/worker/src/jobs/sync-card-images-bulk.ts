import type { Sql } from "postgres";

import {
  fetchBulkDataCatalog,
  findBulkDataEntry,
  streamBulkDataCards,
  ScryfallValidationError,
} from "../integrations/scryfall/client.js";
import { buildImageRows, buildLegalityRows, type CardImageRow, type CardLegalityRow } from "./import-card-images.js";
import type { ScryfallCard } from "../integrations/scryfall/types.js";

export type SyncCardImagesBulkResult = {
  knownPrintings: number;
  cardsScanned: number;
  printingsMatched: number;
  imagesUpserted: number;
  legalitiesUpserted: number;
};

// Flushed periodically rather than buffering the whole catalogue's image
// rows in memory -- the bulk file itself is streamed for the same reason.
const FLUSH_SIZE = 500;

type KnownPrinting = { cardPrintingId: string; oracleCardId: string };

async function loadKnownScryfallIds(sql: Sql): Promise<Map<string, KnownPrinting>> {
  const rows = await sql<{ card_printing_id: string; oracle_card_id: string; scryfall_id: string }[]>`
    select ci.card_printing_id, cp.oracle_card_id, ci.scryfall_id
    from card_identifiers ci
    join card_printings cp on cp.id = ci.card_printing_id
    where ci.scryfall_id is not null
  `;

  return new Map(
    rows.map((row) => [
      row.scryfall_id,
      { cardPrintingId: row.card_printing_id, oracleCardId: row.oracle_card_id },
    ]),
  );
}

async function loadFormatIdByCode(sql: Sql): Promise<Map<string, string>> {
  const rows = await sql<{ id: string; code: string }[]>`select id, code from formats`;
  return new Map(rows.map((row) => [row.code, row.id]));
}

async function upsertImageRows(sql: Sql, rows: CardImageRow[]): Promise<void> {
  if (rows.length === 0) return;

  await sql`
    insert into card_images ${sql(
      rows.map((row) => ({
        card_printing_id: row.cardPrintingId,
        image_type: row.imageType,
        face: row.face,
        url: row.url,
      })),
      "card_printing_id",
      "image_type",
      "face",
      "url",
    )}
    on conflict (card_printing_id, image_type, face) do update set url = excluded.url
  `;
}

async function upsertLegalityRows(sql: Sql, rows: CardLegalityRow[]): Promise<void> {
  if (rows.length === 0) return;

  await sql`
    insert into card_legalities ${sql(
      rows.map((row) => ({
        oracle_card_id: row.oracleCardId,
        format_id: row.formatId,
        status: row.status,
      })),
      "oracle_card_id",
      "format_id",
      "status",
    )}
    on conflict (oracle_card_id, format_id) do update set status = excluded.status, updated_at = now()
  `;
}

// Full-catalogue image and legality sync via Scryfall's daily bulk-data
// export -- "use Scryfall's bulk-data export instead of requesting every
// card individually" for the internal catalogue. One gzipped JSONL download
// (streamBulkDataCards) instead of one /cards/collection request per 75
// printings (fetchCardsByScryfallIds in import-card-images.ts, still the
// right tool for a small/urgent top-up -- see that function's own comment
// on why both exist). Existing collection data (inventory, orders, etc.)
// is never touched here -- this only ever upserts card_images/card_legalities
// rows for printings whose scryfall_id it already knows about; it does not
// create new card_printings or oracle_cards (that stays the MTGJSON
// importer's job).
export async function syncCardImagesFromBulkData(sql: Sql): Promise<SyncCardImagesBulkResult> {
  const [known, formatIdByCode] = await Promise.all([loadKnownScryfallIds(sql), loadFormatIdByCode(sql)]);

  const result: SyncCardImagesBulkResult = {
    knownPrintings: known.size,
    cardsScanned: 0,
    printingsMatched: 0,
    imagesUpserted: 0,
    legalitiesUpserted: 0,
  };

  if (known.size === 0) {
    return result;
  }

  const catalog = await fetchBulkDataCatalog();
  const entry = findBulkDataEntry(catalog, "default_cards");

  if (!entry?.jsonl_download_uri) {
    throw new ScryfallValidationError(
      "Scryfall bulk-data catalog has no default_cards jsonl_download_uri",
    );
  }

  let imageBuffer: CardImageRow[] = [];
  let legalityBuffer: CardLegalityRow[] = [];
  // Every printing of the same oracle card carries the same legalities --
  // recomputing (harmlessly, via upsert) for each one is wasted work across
  // an entire full-catalogue pass, unlike the incremental job's much
  // smaller per-run batches, so this pass dedupes.
  const seenOracleCards = new Set<string>();

  async function flush() {
    await Promise.all([upsertImageRows(sql, imageBuffer), upsertLegalityRows(sql, legalityBuffer)]);
    result.imagesUpserted += imageBuffer.length;
    result.legalitiesUpserted += legalityBuffer.length;
    imageBuffer = [];
    legalityBuffer = [];
  }

  await streamBulkDataCards(entry.jsonl_download_uri, async (card: ScryfallCard) => {
    result.cardsScanned += 1;

    const printing = known.get(card.id);
    if (!printing) {
      return;
    }

    result.printingsMatched += 1;
    imageBuffer.push(...buildImageRows(printing.cardPrintingId, card));

    if (!seenOracleCards.has(printing.oracleCardId)) {
      seenOracleCards.add(printing.oracleCardId);
      legalityBuffer.push(...buildLegalityRows(printing.oracleCardId, card, formatIdByCode));
    }

    if (imageBuffer.length + legalityBuffer.length >= FLUSH_SIZE) {
      await flush();
    }
  });

  await flush();

  return result;
}
