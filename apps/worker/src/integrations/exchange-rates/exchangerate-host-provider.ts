import type { CurrencyPair, ExchangeRate, ExchangeRateProvider } from "./types.js";

// exchangerate.host: a free, no-key latest-rate endpoint
// (https://api.exchangerate.host/latest?base=X&symbols=Y). One request per
// base currency in the requested pairs, since the endpoint only takes a
// single base -- pairs sharing a base are batched into one request.
const EXCHANGE_RATE_HOST_BASE_URL = "https://api.exchangerate.host/latest";

export class ExchangeRateValidationError extends Error {}

type ExchangeRateHostResponse = {
  success?: boolean;
  base: string;
  date: string;
  rates: Record<string, number>;
};

function groupTargetsByBase(pairs: CurrencyPair[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const { base, target } of pairs) {
    const existing = grouped.get(base);
    if (existing) {
      if (!existing.includes(target)) existing.push(target);
    } else {
      grouped.set(base, [target]);
    }
  }
  return grouped;
}

export async function fetchExchangeRateHostRates(base: string): Promise<ExchangeRateHostResponse> {
  const response = await fetch(`${EXCHANGE_RATE_HOST_BASE_URL}?base=${base}`);

  if (!response.ok) {
    throw new ExchangeRateValidationError(
      `exchangerate.host request for base "${base}" failed with HTTP ${response.status}`,
    );
  }

  const body = (await response.json()) as ExchangeRateHostResponse;

  if (!body?.rates || typeof body.rates !== "object" || !body?.date) {
    throw new ExchangeRateValidationError(
      `exchangerate.host response for base "${base}" is missing rates or date`,
    );
  }

  return body;
}

// Pure mapping, kept separate from the fetch above so it's unit-testable
// against a fixture response without a network call (same split as every
// other adapter in this repo).
export function mapExchangeRateHostResponse(
  response: ExchangeRateHostResponse,
  targets: string[],
): ExchangeRate[] {
  const rates: ExchangeRate[] = [];
  const observedAt = new Date(response.date).toISOString();

  for (const target of targets) {
    const rate = response.rates[target];
    if (typeof rate !== "number") continue;

    rates.push({
      provider: "exchangerate_host",
      baseCurrency: response.base,
      targetCurrency: target,
      rate,
      observedAt,
    });
  }

  return rates;
}

export class ExchangeRateHostProvider implements ExchangeRateProvider {
  code = "exchangerate_host";

  async fetchRates(pairs: CurrencyPair[]): Promise<ExchangeRate[]> {
    const grouped = groupTargetsByBase(pairs);
    const rates: ExchangeRate[] = [];

    for (const [base, targets] of grouped) {
      const response = await fetchExchangeRateHostRates(base);
      rates.push(...mapExchangeRateHostResponse(response, targets));
    }

    return rates;
  }
}
