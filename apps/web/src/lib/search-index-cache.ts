// Loads the search index snapshot the worker persists to Supabase Storage
// (apps/worker/src/search/index-store.ts) directly into this serverless
// function's own process, rather than calling a separately-hosted worker
// HTTP endpoint -- Vercel functions are the only deployment target
// available, and there is no persistently-reachable worker service to call.
//
// A module-level cache is what makes this viable: Vercel reuses a warm
// function instance across many requests, so only the (comparatively rare)
// cold start pays the cost of downloading and decompressing the snapshot.
// Reloading uses MiniSearch's own toJSON()/loadJS() serialization
// (deserializeSearchIndex), not a full re-tokenize from raw documents, to
// keep that cold-start cost as low as it can be at ~800k documents.
//
// Refreshing is stale-while-revalidate: once a snapshot is cached, an
// expired TTL kicks off a background reload for the *next* request rather
// than blocking the current one -- no single search request should ever pay
// for re-downloading and re-parsing the whole index.
import { gunzipSync } from "node:zlib";

import {
  deserializeSearchIndex,
  runSearch,
  type SearchIndex,
  type SearchOutcome,
  type SearchQueryParams,
} from "@probable-winner/search";

import { createPublicSupabaseClient } from "@/server/supabase";
import { logger } from "@/lib/logger";

const STORAGE_BUCKET = "search-index";
const STORAGE_OBJECT_PATH = "snapshot.json.gz";
const REFRESH_INTERVAL_MS = 60_000;

let cachedIndex: SearchIndex | null = null;
let cachedAt = 0;
let loadPromise: Promise<SearchIndex> | null = null;

async function downloadAndDeserializeIndex(): Promise<SearchIndex> {
  const supabase = createPublicSupabaseClient();

  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(STORAGE_OBJECT_PATH);

  if (error || !data) {
    throw new Error(`Failed to download search index snapshot: ${error?.message ?? "no data"}`);
  }

  const compressed = Buffer.from(await data.arrayBuffer());
  const json = gunzipSync(compressed).toString("utf-8");
  return deserializeSearchIndex(json);
}

function refreshInBackground(): void {
  if (loadPromise) return;

  loadPromise = downloadAndDeserializeIndex()
    .then((index) => {
      cachedIndex = index;
      cachedAt = Date.now();
      return index;
    })
    .catch((error: unknown) => {
      logger.error("Failed to refresh search index snapshot", {
        error: logger.serializeError(error),
      });
      // Keep serving the stale cached index (if any) rather than failing
      // every search until the next successful refresh.
      if (cachedIndex) return cachedIndex;
      throw error;
    })
    .finally(() => {
      loadPromise = null;
    });
}

async function getIndex(): Promise<SearchIndex> {
  if (cachedIndex) {
    if (Date.now() - cachedAt >= REFRESH_INTERVAL_MS) {
      refreshInBackground();
    }
    return cachedIndex;
  }

  // True cold start: nothing cached yet in this function instance, so this
  // request has no choice but to wait for the first load.
  if (!loadPromise) {
    refreshInBackground();
  }
  return loadPromise!;
}

export async function queryLocalSearchIndex(params: SearchQueryParams): Promise<SearchOutcome> {
  const index = await getIndex();
  return runSearch(index, params);
}
