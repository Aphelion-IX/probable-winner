import type {
  MtgJsonSet,
  MtgJsonSetListEntry,
  MtgJsonSetListResponse,
  MtgJsonSetResponse,
} from "./types.js";

const MTGJSON_BASE_URL = "https://mtgjson.com/api/v5";

export class MtgJsonValidationError extends Error {}

export async function fetchSet(setCode: string): Promise<MtgJsonSet> {
  const response = await fetch(`${MTGJSON_BASE_URL}/${setCode.toUpperCase()}.json`);

  if (!response.ok) {
    throw new MtgJsonValidationError(
      `MTGJSON request for set "${setCode}" failed with HTTP ${response.status}`,
    );
  }

  const body = (await response.json()) as MtgJsonSetResponse;

  if (!body?.data || !Array.isArray(body.data.cards) || body.data.cards.length === 0) {
    throw new MtgJsonValidationError(
      `MTGJSON response for set "${setCode}" is missing a non-empty data.cards array`,
    );
  }

  if (body.data.code.toUpperCase() !== setCode.toUpperCase()) {
    throw new MtgJsonValidationError(
      `MTGJSON response set code "${body.data.code}" does not match requested "${setCode}"`,
    );
  }

  return body.data;
}

// Lists every set MTGJSON knows about (code, name, release date) so the
// whole catalogue can be discovered and enqueued for import, rather than
// requiring a caller to already know a specific set code (backlog B-040).
export async function fetchSetList(): Promise<MtgJsonSetListEntry[]> {
  const response = await fetch(`${MTGJSON_BASE_URL}/SetList.json`);

  if (!response.ok) {
    throw new MtgJsonValidationError(`MTGJSON SetList request failed with HTTP ${response.status}`);
  }

  const body = (await response.json()) as MtgJsonSetListResponse;

  if (!Array.isArray(body?.data) || body.data.length === 0) {
    throw new MtgJsonValidationError("MTGJSON SetList response is missing a non-empty data array");
  }

  return body.data;
}
