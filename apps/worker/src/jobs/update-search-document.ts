import type { Sql } from "postgres";
import {
  buildCardSearchDocument,
  createTypesenseClient,
  ensureCardsCollectionExists,
  CARDS_COLLECTION_NAME,
} from "@probable-winner/search";

import { fetchSkuSearchRows } from "./fetch-sku-search-rows.js";

// Incremental single-SKU update (B-083): rebuilds and upserts exactly one
// Typesense document, driven by the search_index queue consumer. Never a
// full reindex per change (blueprint §13.3) — this is the piece that keeps
// search fresh without the "recalculate everything per request" pattern
// blueprint §20 prohibits.
export async function updateSearchDocument(sql: Sql, skuId: string): Promise<boolean> {
  const [row] = await fetchSkuSearchRows(sql, [skuId]);

  const client = createTypesenseClient();
  await ensureCardsCollectionExists(client);

  if (!row) {
    // The SKU is no longer active/sellable (or never existed) — remove any
    // stale document rather than leaving it searchable. Typesense 404s if
    // there was nothing to delete, which isn't a real failure here.
    try {
      await client.collections(CARDS_COLLECTION_NAME).documents(skuId).delete();
    } catch {
      // Already absent from the index — nothing to do.
    }
    return false;
  }

  const document = buildCardSearchDocument(row);
  await client.collections(CARDS_COLLECTION_NAME).documents().upsert(document);
  return true;
}
