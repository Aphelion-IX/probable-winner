import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";

import type {
  ScryfallBulkDataEntry,
  ScryfallBulkDataResponse,
  ScryfallBulkDataType,
  ScryfallCard,
  ScryfallCollectionResponse,
} from "./types.js";

const SCRYFALL_BASE_URL = "https://api.scryfall.com";

// Scryfall's own API etiquette (https://scryfall.com/docs/api) asks for a
// descriptive User-Agent and an explicit Accept header on every request.
const REQUEST_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
  "User-Agent": "ProbableWinner/1.0 (card image importer)",
};

// The collection endpoint's own documented limit.
export const SCRYFALL_COLLECTION_BATCH_LIMIT = 75;

export class ScryfallValidationError extends Error {}

// Batch card lookup by Scryfall printing id (POST /cards/collection) --
// never fetch cards one at a time. Good for a small/incremental top-up
// (e.g. right after a new set is catalogued) where /bulk-data's up-to-
// 24-hour-stale snapshot (see fetchBulkDataCatalog below) isn't fresh
// enough yet -- Scryfall's own bulk-data docs say exactly this: "Bulk data
// is only collected once every 12-24 hours. You can use the card API
// methods to retrieve fresh objects instead." For a full-catalogue sync,
// streamBulkDataCards is the right tool (one download instead of
// thousands of 75-at-a-time requests).
export async function fetchCardsByScryfallIds(
  scryfallIds: string[],
): Promise<ScryfallCollectionResponse> {
  if (scryfallIds.length === 0) {
    return { object: "list", not_found: [], data: [] };
  }

  if (scryfallIds.length > SCRYFALL_COLLECTION_BATCH_LIMIT) {
    throw new ScryfallValidationError(
      `Scryfall's /cards/collection endpoint accepts at most ${SCRYFALL_COLLECTION_BATCH_LIMIT} identifiers per request, got ${scryfallIds.length}`,
    );
  }

  const response = await fetch(`${SCRYFALL_BASE_URL}/cards/collection`, {
    method: "POST",
    headers: REQUEST_HEADERS,
    body: JSON.stringify({ identifiers: scryfallIds.map((id) => ({ id })) }),
  });

  if (!response.ok) {
    throw new ScryfallValidationError(
      `Scryfall /cards/collection request failed with HTTP ${response.status}`,
    );
  }

  const body = (await response.json()) as ScryfallCollectionResponse;

  if (body.object !== "list" || !Array.isArray(body.data)) {
    throw new ScryfallValidationError("Scryfall /cards/collection response is malformed");
  }

  return body;
}

// GET /bulk-data (https://scryfall.com/docs/api/bulk-data): lists the daily
// bulk export files, each with a download_uri/jsonl_download_uri that
// changes every day -- always look this up fresh rather than hardcoding a
// URL.
export async function fetchBulkDataCatalog(): Promise<ScryfallBulkDataEntry[]> {
  const response = await fetch(`${SCRYFALL_BASE_URL}/bulk-data`, {
    headers: REQUEST_HEADERS,
  });

  if (!response.ok) {
    throw new ScryfallValidationError(
      `Scryfall /bulk-data request failed with HTTP ${response.status}`,
    );
  }

  const body = (await response.json()) as ScryfallBulkDataResponse;

  if (body.object !== "list" || !Array.isArray(body.data)) {
    throw new ScryfallValidationError("Scryfall /bulk-data response is malformed");
  }

  return body.data;
}

export function findBulkDataEntry(
  catalog: ScryfallBulkDataEntry[],
  type: ScryfallBulkDataType,
): ScryfallBulkDataEntry | null {
  return catalog.find((entry) => entry.type === type) ?? null;
}

// Streams and parses a bulk-data jsonl.gz file (https://scryfall.com/docs/api/bulk-data)
// without ever holding the whole (172MB-2.4GB uncompressed) file in memory
// at once: the response body is piped through gunzip and read line by
// line, each line being one card's JSON object. onCard is called once per
// card in file order; it should stay cheap (e.g. buffering rows for a
// periodic batched DB flush) since it runs inline with the stream.
export async function streamBulkDataCards(
  jsonlDownloadUri: string,
  onCard: (card: ScryfallCard) => void | Promise<void>,
): Promise<void> {
  const response = await fetch(jsonlDownloadUri, { headers: REQUEST_HEADERS });

  if (!response.ok || !response.body) {
    throw new ScryfallValidationError(
      `Scryfall bulk-data download failed with HTTP ${response.status}`,
    );
  }

  const gunzip = createGunzip();
  Readable.fromWeb(response.body as import("stream/web").ReadableStream<Uint8Array>).pipe(gunzip);

  const lines = createInterface({ input: gunzip, crlfDelay: Infinity });

  for await (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    await onCard(JSON.parse(trimmed) as ScryfallCard);
  }
}
