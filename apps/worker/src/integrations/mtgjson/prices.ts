import type { PricingProvider, ImportedPrice, ProviderHealth } from "../pricing/types.js";
import type { MtgJsonAllPricesTodayResponse } from "./prices-types.js";

const MTGJSON_ALL_PRICES_TODAY_URL = "https://mtgjson.com/api/v5/AllPricesToday.json";

// cardmarket quotes in EUR; every other paper provider MTGJSON aggregates
// (tcgplayer, cardkingdom) quotes in USD. There is no currency field in the
// feed itself, so this is a provider-keyed lookup rather than derived from
// the response.
const EUR_PROVIDERS = new Set(["cardmarket"]);

export class MtgJsonPriceValidationError extends Error {}

// Pure mapping, kept separate from the fetch below so it's unit-testable
// against a fixture without a network call (mirrors client.ts/toStagingRows'
// split for the catalogue importer). The feed has no per-uuid or per-date
// filtering, so `printingIds`/`since` on fetchPrices() below are not (and
// cannot be) applied here -- the import job filters after mapping each row
// to an internal card_printing_id, which this adapter has no knowledge of.
export function mapAllPricesTodayToImportedPrices(
  response: MtgJsonAllPricesTodayResponse,
): ImportedPrice[] {
  const observedAt = new Date(response.meta.date).toISOString();
  const prices: ImportedPrice[] = [];

  for (const [mtgjsonUuid, cardPrices] of Object.entries(response.data)) {
    for (const [provider, providerPrices] of Object.entries(cardPrices.paper ?? {})) {
      for (const [listType, finishAmounts] of Object.entries(providerPrices)) {
        for (const [finish, amount] of Object.entries(finishAmounts ?? {})) {
          if (typeof amount !== "number") continue;

          prices.push({
            provider,
            sourceProductId: mtgjsonUuid,
            language: "en",
            finish: finish as ImportedPrice["finish"],
            priceType: listType === "retail" ? "retail" : "buylist",
            amount,
            currency: EUR_PROVIDERS.has(provider) ? "EUR" : "USD",
            observedAt,
          });
        }
      }
    }
  }

  return prices;
}

export async function fetchAllPricesToday(): Promise<MtgJsonAllPricesTodayResponse> {
  const response = await fetch(MTGJSON_ALL_PRICES_TODAY_URL);

  if (!response.ok) {
    throw new MtgJsonPriceValidationError(
      `MTGJSON AllPricesToday request failed with HTTP ${response.status}`,
    );
  }

  const body = (await response.json()) as MtgJsonAllPricesTodayResponse;

  if (!body?.data || typeof body.data !== "object" || !body?.meta?.date) {
    throw new MtgJsonPriceValidationError(
      "MTGJSON AllPricesToday response is missing a data object or meta.date",
    );
  }

  return body;
}

export class MtgJsonPriceProvider implements PricingProvider {
  code = "mtgjson";

  // No `since`/`printingIds` params: MTGJSON's AllPricesToday feed has no
  // server-side filtering by either (see mapAllPricesTodayToImportedPrices'
  // comment) -- fewer params than the PricingProvider interface declares is
  // a structurally compatible implementation in TypeScript.
  async fetchPrices(): Promise<ImportedPrice[]> {
    const response = await fetchAllPricesToday();
    return mapAllPricesTodayToImportedPrices(response);
  }

  async healthCheck(): Promise<ProviderHealth> {
    try {
      const response = await fetch(MTGJSON_ALL_PRICES_TODAY_URL, { method: "HEAD" });
      return {
        provider: this.code,
        healthy: response.ok,
        checkedAt: new Date().toISOString(),
        message: response.ok ? undefined : `HTTP ${response.status}`,
      };
    } catch (error) {
      return {
        provider: this.code,
        healthy: false,
        checkedAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
