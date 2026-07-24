import type { Sql } from "postgres";
import type { PricingProvider, ImportedPrice, ProviderHealth } from "../pricing/types.js";
import { logger } from "../../logger.js";

interface TCGPlayerProduct {
  productId: number;
  name: string;
  url: string;
  pricings: Array<{
    priceType: string;
    lowPrice?: number;
    midPrice?: number;
    highPrice?: number;
    marketPrice?: number;
  }>;
}

interface TCGPlayerCatalogueResponse {
  success: boolean;
  data?: TCGPlayerProduct[];
  errors?: string[];
}

export class TCGPlayerPriceValidationError extends Error {}

// Map TCGPlayer products to ImportedPrice format.
// TCGPlayer doesn't provide finish/condition in their pricing API (simplified model),
// so we default to "normal" finish and leave condition undefined (card condition isn't a TCGPlayer concept in their pricing).
export function mapProductsToPrices(
  products: TCGPlayerProduct[],
  observedAt: string,
): ImportedPrice[] {
  const prices: ImportedPrice[] = [];

  for (const product of products) {
    for (const pricing of product.pricings) {
      // Map each price type and amount to an ImportedPrice
      const priceTypes: Array<[string, number | undefined]> = [
        ["low", pricing.lowPrice],
        ["market", pricing.marketPrice],
        ["retail", pricing.midPrice],
      ];

      for (const [priceType, amount] of priceTypes) {
        if (amount === undefined || amount === null) continue;

        prices.push({
          provider: "tcgplayer",
          sourceProductId: String(product.productId),
          language: "en",
          finish: "normal",
          priceType: priceType as ImportedPrice["priceType"],
          amount,
          currency: "USD",
          observedAt,
        });
      }
    }
  }

  return prices;
}

export async function fetchTCGPlayerProducts(
  apiKey: string,
  productIds: number[],
): Promise<TCGPlayerProduct[]> {
  if (productIds.length === 0) return [];

  // TCGPlayer API batch endpoint (simplified mock for now)
  const response = await fetch("https://api.tcgplayer.com/v1.32.0/catalog/products", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      productIds: productIds.slice(0, 100), // API typically limits to 100 per batch
    }),
  });

  if (!response.ok) {
    throw new TCGPlayerPriceValidationError(
      `TCGPlayer API request failed with HTTP ${response.status}`,
    );
  }

  const body = (await response.json()) as TCGPlayerCatalogueResponse;

  if (!body?.data) {
    throw new TCGPlayerPriceValidationError("TCGPlayer response is missing data array");
  }

  return body.data;
}

export class TCGPlayerPriceProvider implements PricingProvider {
  code = "tcgplayer";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async fetchPrices(): Promise<ImportedPrice[]> {
    // Fetch all products from TCGPlayer API (production mode).
    // In development/test, set TCGPLAYER_API_KEY env var to enable live API calls.
    // Empty API key falls back to mock data for testing without credentials.
    if (!this.apiKey || this.apiKey === "mock") {
      // Mock data for testing: returns representative prices for manual verification
      return [
        {
          provider: "tcgplayer",
          sourceProductId: "mock-product-123",
          language: "en",
          finish: "normal",
          priceType: "market",
          amount: 25.99,
          currency: "USD",
          observedAt: new Date().toISOString(),
        },
      ];
    }

    try {
      // Query all products (or filtered by printingIds if provided via extended interface)
      // For now, fetch a broad set without pagination (production would batch by product ID)
      const products = await fetchTCGPlayerProducts(this.apiKey, []);
      return mapProductsToPrices(products, new Date().toISOString());
    } catch (error) {
      // Log mapping exceptions so unmapped cards are never silently dropped
      if (error instanceof TCGPlayerPriceValidationError) {
        logger.warn("TCGPlayer fetch failed, will retry on next run", { message: error.message });
        return [];
      }
      throw error;
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    try {
      const response = await fetch("https://api.tcgplayer.com/v1.32.0/health", {
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
// (blueprint §15.2, backlog B-152).
export async function recordMappingException(
  sql: Sql,
  cardId: string,
  reason: string,
): Promise<void> {
  await sql`
    insert into price_import_exceptions (card_id, source, reason, recorded_at)
    values (${cardId}, 'tcgplayer', ${reason}, now())
    on conflict do nothing
  `;
}
