import { PricingProvider, ImportedPrice, MappingException } from "../types.js";

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

interface TCGPlayerResponse {
  success: boolean;
  data?: {
    products: TCGPlayerProduct[];
  };
  errors?: string[];
}

export class TCGPlayerAdapter implements PricingProvider {
  private apiKey: string;
  private baseUrl = "https://api.tcgplayer.com/v1.32.0/catalog";
  private exceptions: MappingException[] = [];
  private onMappingException?: (exception: MappingException) => void | Promise<void>;

  constructor(
    apiKey: string,
    onMappingException?: (exception: MappingException) => void | Promise<void>,
  ) {
    this.apiKey = apiKey;
    this.onMappingException = onMappingException;
  }

  // See CardKingdomAdapter.getMappingExceptions() for why this package
  // tracks exceptions in memory rather than writing to Postgres directly.
  getMappingExceptions(): MappingException[] {
    return this.exceptions;
  }

  async fetchPrices(
    identifiers: Array<{ cardId: string; oracleId?: string }>,
  ): Promise<ImportedPrice[]> {
    this.exceptions = [];
    try {
      // TCGPlayer requires product lookups by name/set/number -- this is a
      // stub that doesn't yet query their API (in production, this would
      // batch-fetch product data and prices). Since no identifier can
      // currently resolve to a price, every one of them is unmapped for
      // audit purposes -- recording that is this adapter's real,
      // non-stubbed responsibility per B-152's AC.

      const prices: ImportedPrice[] = [];

      for (const identifier of identifiers) {
        try {
          // In real implementation: query TCGPlayer API
          // const response = await this.queryTCGPlayer(identifier);
          // if (response) {
          //   prices.push({
          //     source: 'tcgplayer',
          //     sourceId: identifier.cardId,
          //     price: response.marketPrice,
          //     currency: 'USD',
          //     lastUpdated: new Date(),
          //   });
          //   continue;
          // }
          await this.recordMappingException(
            identifier.cardId,
            "TCGPlayer product lookup not yet implemented",
          );
        } catch (error) {
          // Record failed lookup for audit trail
          console.error(`TCGPlayer lookup failed for card ${identifier.cardId}:`, error);
          await this.recordMappingException(identifier.cardId, `Lookup failed: ${String(error)}`);
          // Don't throw - continue processing other cards
        }
      }

      return prices;
    } catch (error) {
      console.error("TCGPlayer adapter fatal error:", error);
      throw new Error(`TCGPlayer adapter failed: ${String(error)}`);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Stub health check - in production would verify API access
      // const response = await fetch(`${this.baseUrl}/products?limit=1`, {
      //   headers: {
      //     Authorization: `Bearer ${this.apiKey}`,
      //   },
      // });
      // return response.ok;
      return true;
    } catch {
      return false;
    }
  }

  private async recordMappingException(cardId: string, reason: string): Promise<void> {
    const exception: MappingException = {
      cardId,
      source: "tcgplayer",
      reason,
      recordedAt: new Date(),
    };
    this.exceptions.push(exception);
    await this.onMappingException?.(exception);
  }
}
