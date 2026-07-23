import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchAllPricesToday,
  mapAllPricesTodayToImportedPrices,
  MtgJsonPriceProvider,
  MtgJsonPriceValidationError,
} from "./prices.js";
import type { MtgJsonAllPricesTodayResponse } from "./prices-types.js";

const fixturePath = fileURLToPath(
  new URL("../../../tests/fixtures/mtgjson-prices-today.json", import.meta.url),
);
const pricesFixture: MtgJsonAllPricesTodayResponse = JSON.parse(readFileSync(fixturePath, "utf-8"));

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

describe("mapAllPricesTodayToImportedPrices", () => {
  it("flattens every provider/list-type/finish combination into one ImportedPrice each", () => {
    const prices = mapAllPricesTodayToImportedPrices(pricesFixture);

    // Card 1: tcgplayer (retail normal+foil, buylist normal) + cardkingdom
    // (retail normal) + cardmarket (retail normal) = 5. Card 2: 1. The
    // mtgo-only uuid contributes 0 (no "paper" key).
    expect(prices).toHaveLength(6);
  });

  it("maps provider, priceType, finish, amount, and currency correctly for a normal retail price", () => {
    const prices = mapAllPricesTodayToImportedPrices(pricesFixture);
    const tcgplayerNormal = prices.find(
      (p) => p.provider === "tcgplayer" && p.priceType === "retail" && p.finish === "normal",
    );

    expect(tcgplayerNormal).toMatchObject({
      sourceProductId: "3dd0bd56-5340-5542-8457-646b9acd58ff",
      amount: 1.23,
      currency: "USD",
      language: "en",
    });
  });

  it("maps a buylist price to priceType 'buylist'", () => {
    const prices = mapAllPricesTodayToImportedPrices(pricesFixture);
    const buylist = prices.find((p) => p.provider === "tcgplayer" && p.priceType === "buylist");

    expect(buylist?.amount).toBe(0.5);
  });

  it("prices a cardmarket entry in EUR, unlike USD-quoting providers", () => {
    const prices = mapAllPricesTodayToImportedPrices(pricesFixture);
    const cardmarket = prices.find((p) => p.provider === "cardmarket");

    expect(cardmarket?.currency).toBe("EUR");
  });

  it("ignores an entry with no 'paper' key (e.g. MTGO-only pricing)", () => {
    const prices = mapAllPricesTodayToImportedPrices(pricesFixture);
    expect(prices.some((p) => p.sourceProductId === "no-paper-data-uuid")).toBe(false);
  });

  it("stamps every price with meta.date converted to an ISO timestamp", () => {
    const prices = mapAllPricesTodayToImportedPrices(pricesFixture);
    expect(prices[0]?.observedAt).toBe(new Date("2026-07-23").toISOString());
  });
});

describe("fetchAllPricesToday", () => {
  it("parses a real AllPricesToday fixture shape", async () => {
    mockFetchOnce(pricesFixture);
    const response = await fetchAllPricesToday();
    expect(response.meta.date).toBe("2026-07-23");
    expect(Object.keys(response.data)).toHaveLength(3);
  });

  it("rejects a non-OK HTTP response", async () => {
    mockFetchOnce({}, false, 503);
    await expect(fetchAllPricesToday()).rejects.toBeInstanceOf(MtgJsonPriceValidationError);
  });

  it("rejects a response missing meta.date", async () => {
    mockFetchOnce({ data: {} });
    await expect(fetchAllPricesToday()).rejects.toBeInstanceOf(MtgJsonPriceValidationError);
  });
});

describe("MtgJsonPriceProvider", () => {
  it("implements PricingProvider.fetchPrices via the fetch + map pipeline", async () => {
    mockFetchOnce(pricesFixture);
    const provider = new MtgJsonPriceProvider();

    const prices = await provider.fetchPrices();
    expect(prices).toHaveLength(6);
    expect(provider.code).toBe("mtgjson");
  });

  it("healthCheck reports healthy on a 200 HEAD response", async () => {
    mockFetchOnce({}, true, 200);
    const provider = new MtgJsonPriceProvider();

    const health = await provider.healthCheck();
    expect(health.healthy).toBe(true);
    expect(health.provider).toBe("mtgjson");
  });

  it("healthCheck reports unhealthy on a non-OK response", async () => {
    mockFetchOnce({}, false, 500);
    const provider = new MtgJsonPriceProvider();

    const health = await provider.healthCheck();
    expect(health.healthy).toBe(false);
    expect(health.message).toContain("500");
  });

  it("healthCheck reports unhealthy if fetch itself throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unreachable")));
    const provider = new MtgJsonPriceProvider();

    const health = await provider.healthCheck();
    expect(health.healthy).toBe(false);
    expect(health.message).toContain("network unreachable");
  });
});
