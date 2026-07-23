import type { Sql } from "postgres";

import { ExchangeRateHostProvider } from "../integrations/exchange-rates/exchangerate-host-provider.js";
import type { CurrencyPair } from "../integrations/exchange-rates/types.js";

// The two source currencies MTGJSON's AllPricesToday feed quotes in
// (tcgplayer/cardkingdom in USD, cardmarket in EUR -- see prices.ts'
// EUR_PROVIDERS), converted to the retailer's currency.
const CURRENCY_PAIRS: CurrencyPair[] = [
  { base: "USD", target: "AUD" },
  { base: "EUR", target: "AUD" },
];

export type ImportExchangeRatesResult = {
  ratesStored: number;
};

// Rates are append-only (exchange_rates has no update path, matching
// price_snapshots' immutability convention), so this is just fetch, map,
// and insert -- ON CONFLICT DO NOTHING makes a same-day retry after a
// crash safe without a run-tracking table the way the price importer
// needs one (a currency pair has no "raw payload before mapping" step
// worth staging separately).
export async function importExchangeRates(sql: Sql): Promise<ImportExchangeRatesResult> {
  const provider = new ExchangeRateHostProvider();
  const rates = await provider.fetchRates(CURRENCY_PAIRS);

  if (rates.length === 0) {
    return { ratesStored: 0 };
  }

  const rows = rates.map((rate) => ({
    provider: rate.provider,
    base_currency: rate.baseCurrency,
    target_currency: rate.targetCurrency,
    rate: rate.rate,
    observed_at: rate.observedAt,
  }));

  await sql`
    insert into exchange_rates ${sql(
      rows,
      "provider",
      "base_currency",
      "target_currency",
      "rate",
      "observed_at",
    )}
    on conflict (provider, base_currency, target_currency, observed_at) do nothing
  `;

  return { ratesStored: rows.length };
}
