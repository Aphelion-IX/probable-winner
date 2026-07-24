// Popularity score calculation (B-085, blueprint §13.6)
// Computes search ranking score from real order/inventory metrics, batched
// across every SKU in one query (never one query per SKU), and writes the
// result directly into each SKU's Typesense document — popularity_score is
// a search-ranking artifact, not business data, so it has no Postgres
// column of its own (blueprint §13.2's CardSearchDocument is where it
// lives).

import type { Sql } from "postgres";
import { createTypesenseClient, CARDS_COLLECTION_NAME } from "@probable-winner/search";

const IMPORT_BATCH_SIZE = 1000;

export type PopularityMetrics = {
  totalOrders: number;
  totalQuantitySold: number;
  inventoryDepth: number;
  availabilityStores: number;
  daysSinceLastSale: number;
};

export function calculatePopularityScore(metrics: PopularityMetrics): number {
  const ordersFactor = Math.min(metrics.totalOrders / 100, 1) * 20; // Max 20 points
  const volumeFactor = Math.min(metrics.totalQuantitySold / 500, 1) * 20; // Max 20 points
  const inventoryFactor = Math.min(metrics.inventoryDepth / 50, 1) * 20; // Max 20 points
  const availabilityFactor = Math.min(metrics.availabilityStores / 10, 1) * 20; // Max 20 points
  const recencyFactor =
    metrics.daysSinceLastSale === 0
      ? 20
      : Math.max(0, 20 * (1 - metrics.daysSinceLastSale / 30)); // Max 20 points, decays over 30 days

  return Math.round(ordersFactor + volumeFactor + inventoryFactor + availabilityFactor + recencyFactor);
}

type MetricsRow = {
  sku_id: string;
  total_orders: string;
  total_quantity_sold: string;
  last_sale_at: string | null;
  inventory_depth: string;
  availability_stores: string;
};

const NO_SALE_DAYS = 9_999; // large enough that calculatePopularityScore's recency factor clamps to 0

export async function fetchPopularityMetrics(sql: Sql): Promise<Map<string, PopularityMetrics>> {
  const rows = await sql<MetricsRow[]>`
    with sales as (
      select
        ol.sellable_sku_id,
        count(distinct ol.order_id) as total_orders,
        sum(ol.quantity) as total_quantity_sold,
        max(ol.created_at) as last_sale_at
      from order_lines ol
      join orders o on o.id = ol.order_id
      where o.status != 'cancelled'
      group by ol.sellable_sku_id
    ),
    balances as (
      select
        sellable_sku_id,
        sum(quantity_on_hand) as inventory_depth,
        count(*) filter (where quantity_available_online > 0) as availability_stores
      from inventory_balances
      group by sellable_sku_id
    )
    select
      sk.id as sku_id,
      coalesce(sales.total_orders, 0) as total_orders,
      coalesce(sales.total_quantity_sold, 0) as total_quantity_sold,
      sales.last_sale_at,
      coalesce(balances.inventory_depth, 0) as inventory_depth,
      coalesce(balances.availability_stores, 0) as availability_stores
    from sellable_skus sk
    left join sales on sales.sellable_sku_id = sk.id
    left join balances on balances.sellable_sku_id = sk.id
  `;

  const now = Date.now();
  const metrics = new Map<string, PopularityMetrics>();

  for (const row of rows) {
    const daysSinceLastSale = row.last_sale_at
      ? Math.floor((now - new Date(row.last_sale_at).getTime()) / (24 * 60 * 60 * 1000))
      : NO_SALE_DAYS;

    metrics.set(row.sku_id, {
      totalOrders: Number(row.total_orders),
      totalQuantitySold: Number(row.total_quantity_sold),
      inventoryDepth: Number(row.inventory_depth),
      availabilityStores: Number(row.availability_stores),
      daysSinceLastSale,
    });
  }

  return metrics;
}

export type PopularityScoringResult = {
  status: "completed" | "failed";
  updated: number;
  failed: number;
  error?: string;
};

export async function updateAllPopularityScores(sql: Sql): Promise<PopularityScoringResult> {
  try {
    const metricsBySkuId = await fetchPopularityMetrics(sql);

    const documents = Array.from(metricsBySkuId, ([skuId, metrics]) => ({
      id: skuId,
      popularity_score: calculatePopularityScore(metrics),
    }));

    const client = createTypesenseClient();

    let updated = 0;
    let failed = 0;

    for (let i = 0; i < documents.length; i += IMPORT_BATCH_SIZE) {
      const batch = documents.slice(i, i + IMPORT_BATCH_SIZE);
      const results = await client
        .collections(CARDS_COLLECTION_NAME)
        .documents()
        .import(batch, { action: "update" });

      for (const result of results) {
        if (result.success) {
          updated += 1;
        } else {
          // Expected for any SKU not yet reindexed into Typesense — not a
          // real failure, just nothing to update yet.
          failed += 1;
        }
      }
    }

    return { status: "completed", updated, failed };
  } catch (error) {
    return {
      status: "failed",
      updated: 0,
      failed: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
