import type { ScryfallCollectionResponse } from "./types.js";

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
// never fetch cards one at a time; this is the bulk endpoint Scryfall
// provides specifically so an importer doesn't need to hit /cards/:id in a
// loop. Card image import (the only current caller) only ever needs a
// handful of image URLs per card, not the full bulk-data file, so this is
// the right endpoint for it -- the bulk-data export is for the catalogue
// importer's own metadata sync, a separate, larger concern.
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
