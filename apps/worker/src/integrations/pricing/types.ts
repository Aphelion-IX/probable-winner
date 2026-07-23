// Pricing provider adapter interface (blueprint §15.1/§15.2, backlog B-150).
// Every provider (MTGJSON, TCGplayer, Card Kingdom, exchange-rate) implements
// this same shape so the import job never depends on a provider's native
// response format — only on ImportedPrice, which each adapter maps into.

export type ImportedPrice = {
  provider: string;
  sourceProductId: string;
  sourceSkuId?: string;
  printingId?: string;
  scryfallId?: string;
  setCode?: string;
  collectorNumber?: string;
  language: string;
  finish: "normal" | "foil" | "etched";
  condition?: "NM" | "LP" | "MP" | "HP" | "DMG";
  priceType: "market" | "low" | "retail" | "buylist" | "recent_sale";
  amount: number;
  currency: string;
  observedAt: string;
};

export type ProviderHealth = {
  provider: string;
  healthy: boolean;
  checkedAt: string;
  message?: string;
};

export interface PricingProvider {
  code: string;
  fetchPrices(input: { since?: Date; printingIds?: string[] }): Promise<ImportedPrice[]>;
  healthCheck(): Promise<ProviderHealth>;
}
