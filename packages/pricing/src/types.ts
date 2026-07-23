export interface ImportedPrice {
  source: 'mtgjson' | 'tcgplayer' | 'card_kingdom';
  sourceId: string;
  price: number;
  currency: string;
  lastUpdated: Date;
  metadata?: Record<string, unknown>;
}

export interface PricingProvider {
  fetchPrices(
    identifiers: Array<{ cardId: string; oracleId?: string }>
  ): Promise<ImportedPrice[]>;
  healthCheck(): Promise<boolean>;
}

export interface MappingException {
  cardId: string;
  source: string;
  reason: string;
  recordedAt: Date;
}
