// Exchange-rate adapter interface (blueprint §15.1/§15.3, backlog B-153).
// A separate interface from PricingProvider -- a currency pair/rate isn't
// card-shaped (no printing/condition/finish), so it doesn't fit
// ImportedPrice. "Exchange-rate adapter" in the blueprint's provider list
// means a module with this same fetch-then-map shape, not a literal
// implementer of PricingProvider.

export type ExchangeRate = {
  provider: string;
  baseCurrency: string;
  targetCurrency: string;
  rate: number;
  observedAt: string;
};

export type CurrencyPair = { base: string; target: string };

export interface ExchangeRateProvider {
  code: string;
  fetchRates(pairs: CurrencyPair[]): Promise<ExchangeRate[]>;
}

// Stale-rate detection (B-153's core AC): feeds the "stale data" review
// trigger in B-162's anomaly checks. A rate observed more than
// maxAgeMs before `now` is stale -- exactly at the boundary counts as
// stale too, matching the inclusive '<=' the reservation-expiry job uses
// for "at or past now()" in 20260723070907.
export function isRateStale(rate: ExchangeRate, now: Date, maxAgeMs: number): boolean {
  const observedAt = new Date(rate.observedAt).getTime();
  return now.getTime() - observedAt >= maxAgeMs;
}
