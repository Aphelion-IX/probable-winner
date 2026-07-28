import { gunzipSync, gzipSync } from "node:zlib";

import type { Sql } from "postgres";
import { createClient } from "@supabase/supabase-js";
import {
  buildCardSearchDocument,
  buildSearchIndex,
  createEmptySearchIndex,
  deserializeSearchIndex,
  patchDocument,
  removeDocument,
  runSearch,
  serializeSearchIndex,
  upsertDocument,
  type SearchIndex,
  type SearchOutcome,
  type SearchQueryParams,
} from "@probable-winner/search";

import { fetchSkuSearchRows } from "../jobs/fetch-sku-search-rows.js";
import { logger } from "../logger.js";

// Unlike Typesense (an external service that held the index itself), a
// MiniSearch index is just data structures in this process's memory --
// something has to hold that state, and this worker (a long-running
// process, unlike apps/web's ephemeral serverless functions) is that thing.
// One module-level singleton, mutated in place by the queue consumer and
// the reindex jobs, and read by the HTTP server (search-http-server.ts).
let index: SearchIndex = createEmptySearchIndex();
let lastBuiltAt: number | null = null;

const STORAGE_BUCKET = "search-index";
const STORAGE_OBJECT_PATH = "snapshot.json.gz";

export function getIndexStats(): { documentCount: number; lastBuiltAt: number | null } {
  return { documentCount: index.docsById.size, lastBuiltAt };
}

export function search(params: SearchQueryParams): SearchOutcome {
  return runSearch(index, params);
}

function requireStorageClient() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }

  return createClient(url, serviceRoleKey).storage.from(STORAGE_BUCKET);
}

// Best-effort accelerator, not a hard dependency: at the catalogue's real
// scale (~800k active SKUs) the serialized snapshot is several hundred MB
// uncompressed, large enough that upload/download failures (size limits,
// transient network errors) are a real possibility, not a hypothetical.
// Every caller treats a failure here as "fall back to rebuildFullIndex()",
// never as fatal.
export async function persistSnapshotToStorage(): Promise<void> {
  try {
    const json = serializeSearchIndex(index);
    const compressed = gzipSync(Buffer.from(json, "utf-8"));

    const { error } = await requireStorageClient().upload(STORAGE_OBJECT_PATH, compressed, {
      contentType: "application/gzip",
      upsert: true,
    });

    if (error) {
      logger.error("Failed to persist search index snapshot", {
        error: logger.serializeError(error),
      });
    }
  } catch (error) {
    logger.error("Failed to persist search index snapshot", { error: logger.serializeError(error) });
  }
}

// Returns true only on a fully successful load -- any failure leaves the
// existing in-memory index untouched so the caller can fall back to
// rebuildFullIndex() instead of running with a partially-loaded index.
export async function loadSnapshotFromStorage(): Promise<boolean> {
  try {
    const { data, error } = await requireStorageClient().download(STORAGE_OBJECT_PATH);
    if (error || !data) {
      return false;
    }

    const compressed = Buffer.from(await data.arrayBuffer());
    const json = gunzipSync(compressed).toString("utf-8");

    index = deserializeSearchIndex(json);
    lastBuiltAt = Date.now();
    return true;
  } catch (error) {
    logger.error("Failed to load search index snapshot", { error: logger.serializeError(error) });
    return false;
  }
}

export async function rebuildFullIndex(
  sql: Sql,
): Promise<{ documentCount: number; durationMs: number }> {
  const start = Date.now();

  const rows = await fetchSkuSearchRows(sql);
  const documents = rows.map((row) => buildCardSearchDocument(row));

  index = buildSearchIndex(documents);
  lastBuiltAt = Date.now();

  await persistSnapshotToStorage();

  return { documentCount: documents.length, durationMs: Date.now() - start };
}

// Incremental single-SKU update (B-083): rebuilds exactly one document in
// the live in-memory index, driven by the search_index queue consumer.
// Never a full reindex per change (blueprint §13.3). No snapshot persist
// here -- doing that per event would mean re-uploading a several-hundred-MB
// blob on every single price/stock change, which the periodic snapshot
// (see apps/worker/src/index.ts) exists specifically to avoid.
export async function upsertSkuDocument(sql: Sql, skuId: string): Promise<boolean> {
  const [row] = await fetchSkuSearchRows(sql, [skuId]);

  if (!row) {
    // The SKU is no longer active/sellable (or never existed) -- remove any
    // stale document rather than leaving it searchable.
    removeDocument(index, skuId);
    return false;
  }

  upsertDocument(index, buildCardSearchDocument(row));
  return true;
}

export function patchPopularityScore(skuId: string, popularityScore: number): boolean {
  return patchDocument(index, skuId, { popularity_score: popularityScore });
}
