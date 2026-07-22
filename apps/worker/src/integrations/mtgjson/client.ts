import type { MtgJsonSet, MtgJsonSetResponse } from "./types.js";

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
