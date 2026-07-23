import type { Sql } from "postgres";
import type { PricingProvider, ImportedPrice, ProviderHealth } from "../pricing/types.js";

interface CardKingdomProduct {
  id: string;
  name: string;
  setName: string;
  cardNumber: string;
  normalPrice?: number;
  foilPrice?: number;
  oracleId: string;
}

interface CardKingdomResponse {
  success: boolean;
  data?: CardKingdomProduct[];
  error?: string;
}

export class CardKingdomPriceValidationError extends Error {}

// Map Card Kingdom products to ImportedPrice format.
// Card Kingdom separates normal and foil finishes explicitly in the response,
// so we emit two prices per product (one for normal, one for foil).
export function mapProductsToPrices(
  products: CardKingdomProduct[],
  observedAt: string,
): ImportedPrice[] {
  const prices: ImportedPrice[] = [];

  for (const product of products) {
    // Normal finish
    if (product.normalPrice !== undefined && product.normalPrice !== null) {
      prices.push({
        provider: "card_kingdom",
        sourceProductId: product.id,
        sourceSkuId: `${product.id}-normal`,
        language: "en",
        finish: "normal",
        priceType: "retail",
        amount: product.normalPrice,
        currency: "USD",
        observedAt,
      });
    }

    // Foil finish
    if (product.foilPrice !== undefined && product.foilPrice !== null) {
      prices.push({
        provider: "card_kingdom",
        sourceProductId: product.id,
        sourceSkuId: `${product.id}-foil`,
        language: "en",
        finish: "foil",
        priceType: "retail",
        amount: product.foilPrice,
        currency: "USD",
        observedAt,
      });
    }
  }

  return prices;
}

export async function fetchCardKingdomProducts(
  apiKey: string,
  oracleIds: string[],
): Promise<CardKingdomProduct[]> {
  if (oracleIds.length === 0) return [];

  // Card Kingdom API batch endpoint (simplified mock for now)
  const response = await fetch("https://api.cardkingdom.com/api/v1/products", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      oracleIds: oracleIds.slice(0, 100), // Typical API batch limit
    }),
  });

  if (!response.ok) {
    throw new CardKingdomPriceValidationError(
      `Card Kingdom API request failed with HTTP ${response.status}`,
    );
  }

  const body = (await response.json()) as CardKingdomResponse;

  if (!body?.data) {
    throw new CardKingdomPriceValidationError("Card Kingdom response is missing data array");
  }

  return body.data;
}

export class CardKingdomPriceProvider implements PricingProvider {
  code = "card_kingdom";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async fetchPrices(): Promise<ImportedPrice[]> {
    // Stub implementation: in production, this would query Card Kingdom API
    // for products by oracle_id. For now, return empty to allow B-152 structure
    // without external API dependency.
    return [];
  }

  async healthCheck(): Promise<ProviderHealth> {
    try {
      const response = await fetch("https://api.cardkingdom.com/api/v1/health", {
        method: "HEAD",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });
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

// Record a mapping exception in the database so unmapped cards are not silently dropped
// (blueprint §15.2, backlog B-152). Card Kingdom specifically requires oracle_id for lookups.
export async function recordMappingException(
  sql: Sql,
  cardId: string,
  reason: string,
): Promise<void> {
  await sql`
    insert into price_import_exceptions (card_id, source, reason, recorded_at)
    values (${cardId}, 'card_kingdom', ${reason}, now())
    on conflict do nothing
  `;
}
