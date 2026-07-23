import { PricingProvider, ImportedPrice } from '../types.js';

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
  data?: {
    products: CardKingdomProduct[];
  };
  error?: string;
}

export class CardKingdomAdapter implements PricingProvider {
  private apiKey: string;
  private baseUrl = 'https://api.cardkingdom.com/api/v1';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async fetchPrices(
    identifiers: Array<{ cardId: string; oracleId?: string }>
  ): Promise<ImportedPrice[]> {
    try {
      // Card Kingdom requires oracle_id based lookups
      // Filter identifiers that have oracle_id (Card Kingdom primary key)
      const validIdentifiers = identifiers.filter(
        (id) => id.oracleId && id.oracleId.trim() !== ''
      );
      const unmappedIdentifiers = identifiers.filter(
        (id) => !id.oracleId || id.oracleId.trim() === ''
      );

      const prices: ImportedPrice[] = [];

      // Record exceptions for unmapped cards
      for (const unmapped of unmappedIdentifiers) {
        await this.recordMappingException(
          unmapped.cardId,
          'Missing oracle_id required for Card Kingdom lookup'
        );
      }

      // Process cards with oracle_id
      for (const identifier of validIdentifiers) {
        try {
          // Stub: attempt to fetch price for identifier
          // In production: query Card Kingdom API with oracle_id
          // const response = await this.queryCardKingdom(identifier.oracleId);
          // if (response) {
          //   prices.push({
          //     source: 'card_kingdom',
          //     sourceId: identifier.oracleId,
          //     price: response.normalPrice,
          //     currency: 'USD',
          //     lastUpdated: new Date(),
          //   });
          // }
        } catch (error) {
          // Record lookup failure
          console.error(
            `Card Kingdom lookup failed for oracle_id ${identifier.oracleId}:`,
            error
          );
          await this.recordMappingException(
            identifier.cardId,
            `API lookup failed: ${String(error)}`
          );
          // Don't throw - continue processing
        }
      }

      return prices;
    } catch (error) {
      console.error('Card Kingdom adapter fatal error:', error);
      throw new Error(`Card Kingdom adapter failed: ${String(error)}`);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Stub health check
      // In production: verify API endpoint accessibility
      // const response = await fetch(`${this.baseUrl}/health`, {
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

  private async recordMappingException(
    cardId: string,
    reason: string
  ): Promise<void> {
    // In production: store in price_import_exceptions table
    // Blueprint §15.2: mapping exceptions recorded not dropped silently
    console.warn(
      `Mapping exception for Card Kingdom card ${cardId}: ${reason}`
    );
  }
}
