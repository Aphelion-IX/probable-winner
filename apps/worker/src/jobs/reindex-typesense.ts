// Full Typesense reindex job (B-081, blueprint §13.3)
// Rebuilds the entire search index from Postgres without affecting customer
// traffic: builds the full document set, then upserts it into the existing
// collection (creating the collection first if it doesn't exist yet) rather
// than deleting and recreating, so searches keep working against the old
// documents until each is overwritten.

import type { Sql } from "postgres";
import {
  buildCardSearchDocument,
  createTypesenseClient,
  ensureCardsCollectionExists,
  CARDS_COLLECTION_NAME,
} from "@probable-winner/search";

import { fetchSkuSearchRows } from "./fetch-sku-search-rows.js";

const IMPORT_BATCH_SIZE = 1000;

export type ReindexResult = {
  status: "completed" | "failed";
  documentsIndexed: number;
  documentsFailed: number;
  durationMs: number;
  error?: string;
};

export async function reindexTypesense(sql: Sql): Promise<ReindexResult> {
  const startTime = Date.now();

  try {
    const rows = await fetchSkuSearchRows(sql);
    const documents = rows.map((row) => buildCardSearchDocument(row));

    const client = createTypesenseClient();
    await ensureCardsCollectionExists(client);

    let documentsIndexed = 0;
    let documentsFailed = 0;

    for (let i = 0; i < documents.length; i += IMPORT_BATCH_SIZE) {
      const batch = documents.slice(i, i + IMPORT_BATCH_SIZE);
      const results = await client
        .collections(CARDS_COLLECTION_NAME)
        .documents()
        .import(batch, { action: "upsert" });

      for (const result of results) {
        if (result.success) {
          documentsIndexed += 1;
        } else {
          documentsFailed += 1;
        }
      }
    }

    return {
      status: "completed",
      documentsIndexed,
      documentsFailed,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      status: "failed",
      documentsIndexed: 0,
      documentsFailed: 0,
      durationMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
