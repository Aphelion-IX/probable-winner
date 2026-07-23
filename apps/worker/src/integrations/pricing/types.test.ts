import { describe, expect, it } from "vitest";

import type { ImportedPrice, PricingProvider, ProviderHealth } from "./types.js";

// A minimal mock provider proves the interface is implementable by any
// adapter shape (backlog B-150's AC) without pulling in a real provider's
// fetch/parse logic.
class MockProvider implements PricingProvider {
  code = "mock";

  async fetchPrices(input: { since?: Date; printingIds?: string[] }): Promise<ImportedPrice[]> {
    return [
      {
        provider: this.code,
        sourceProductId: "mock-product-1",
        printingId: input.printingIds?.[0],
        language: "en",
        finish: "normal",
        priceType: "market",
        amount: 1.23,
        currency: "USD",
        observedAt: (input.since ?? new Date()).toISOString(),
      },
    ];
  }

  async healthCheck(): Promise<ProviderHealth> {
    return { provider: this.code, healthy: true, checkedAt: new Date().toISOString() };
  }
}

describe("PricingProvider", () => {
  it("a mock provider can implement fetchPrices and healthCheck", async () => {
    const provider: PricingProvider = new MockProvider();

    const prices = await provider.fetchPrices({ printingIds: ["printing-1"] });
    expect(prices).toHaveLength(1);
    expect(prices[0]?.provider).toBe("mock");
    expect(prices[0]?.printingId).toBe("printing-1");

    const health = await provider.healthCheck();
    expect(health.healthy).toBe(true);
    expect(health.provider).toBe("mock");
  });

  it("business logic depends only on ImportedPrice fields, not a provider's native shape", async () => {
    const provider: PricingProvider = new MockProvider();
    const [price] = await provider.fetchPrices({});

    const importedPriceKeys: (keyof ImportedPrice)[] = [
      "provider",
      "sourceProductId",
      "language",
      "finish",
      "priceType",
      "amount",
      "currency",
      "observedAt",
    ];
    for (const key of importedPriceKeys) {
      expect(price).toHaveProperty(key);
    }
  });
});
