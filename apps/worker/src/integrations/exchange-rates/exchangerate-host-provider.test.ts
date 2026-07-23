import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ExchangeRateHostProvider,
  ExchangeRateValidationError,
  fetchExchangeRateHostRates,
  mapExchangeRateHostResponse,
} from "./exchangerate-host-provider.js";

const fixturePath = fileURLToPath(
  new URL("../../../tests/fixtures/exchangerate-host-usd.json", import.meta.url),
);
const usdFixture = JSON.parse(readFileSync(fixturePath, "utf-8"));

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok,
      status,
      json: async () => body,
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mapExchangeRateHostResponse", () => {
  it("maps only the requested target currencies, in order", () => {
    const rates = mapExchangeRateHostResponse(usdFixture, ["AUD", "EUR"]);

    expect(rates).toHaveLength(2);
    expect(rates[0]).toMatchObject({ baseCurrency: "USD", targetCurrency: "AUD", rate: 1.55 });
    expect(rates[1]).toMatchObject({ baseCurrency: "USD", targetCurrency: "EUR", rate: 0.86 });
  });

  it("ignores a requested target the response doesn't have a rate for", () => {
    const rates = mapExchangeRateHostResponse(usdFixture, ["AUD", "NZD"]);
    expect(rates).toHaveLength(1);
    expect(rates[0]?.targetCurrency).toBe("AUD");
  });

  it("stamps every rate with the response date converted to an ISO timestamp", () => {
    const rates = mapExchangeRateHostResponse(usdFixture, ["AUD"]);
    expect(rates[0]?.observedAt).toBe(new Date("2026-07-23").toISOString());
  });
});

describe("fetchExchangeRateHostRates", () => {
  it("parses a real exchangerate.host fixture shape", async () => {
    mockFetchOnce(usdFixture);
    const response = await fetchExchangeRateHostRates("USD");
    expect(response.base).toBe("USD");
    expect(response.rates.AUD).toBe(1.55);
  });

  it("rejects a non-OK HTTP response", async () => {
    mockFetchOnce({}, false, 503);
    await expect(fetchExchangeRateHostRates("USD")).rejects.toBeInstanceOf(
      ExchangeRateValidationError,
    );
  });

  it("rejects a response missing rates", async () => {
    mockFetchOnce({ base: "USD", date: "2026-07-23" });
    await expect(fetchExchangeRateHostRates("USD")).rejects.toBeInstanceOf(
      ExchangeRateValidationError,
    );
  });
});

describe("ExchangeRateHostProvider", () => {
  it("batches pairs sharing the same base into one request", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => usdFixture,
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new ExchangeRateHostProvider();
    const rates = await provider.fetchRates([
      { base: "USD", target: "AUD" },
      { base: "USD", target: "EUR" },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(rates).toHaveLength(2);
    expect(provider.code).toBe("exchangerate_host");
  });

  it("issues one request per distinct base currency", async () => {
    const eurFixture = { success: true, base: "EUR", date: "2026-07-23", rates: { AUD: 1.8 } };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => usdFixture })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => eurFixture });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new ExchangeRateHostProvider();
    const rates = await provider.fetchRates([
      { base: "USD", target: "AUD" },
      { base: "EUR", target: "AUD" },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(rates).toHaveLength(2);
    expect(rates.map((r) => r.baseCurrency).sort()).toEqual(["EUR", "USD"]);
  });
});
