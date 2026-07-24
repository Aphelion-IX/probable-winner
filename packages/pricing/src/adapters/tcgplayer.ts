import { PricingProvider, ImportedPrice } from "../types.js";

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

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async fetchPrices(
    identifiers: Array<{ cardId: string; oracleId?: string }>,
  ): Promise<ImportedPrice[]> {
    try {
      // TCGPlayer requires product lookups by name/set/number
      // For now, this is a stub that would query their API
      // In production, this would batch-fetch product data and prices

      const prices: ImportedPrice[] = [];

      for (const identifier of identifiers) {
        try {
          // Stub: attempt to fetch price for identifier
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
          // } else {
          //   Store mapping exception
          // }
        } catch (error) {
          // Record failed lookup for audit trail
          console.error(`TCGPlayer lookup failed for card ${identifier.cardId}:`, error);
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
    // In production: store in price_import_exceptions table
    // This prevents silent data loss on unresolved cards
    console.warn(`Mapping exception for TCGPlayer card ${cardId}: ${reason}`);
  }
}
