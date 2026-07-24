import { describe, it, expect } from "vitest";
import { calculatePopularityScore } from "../calculate-popularity-score.js";

describe("calculatePopularityScore", () => {
  it("should return 0 for no activity", () => {
    const score = calculatePopularityScore({
      totalOrders: 0,
      totalQuantitySold: 0,
      inventoryDepth: 0,
      availabilityStores: 0,
      daysSinceLastSale: 30,
    });
    expect(score).toBe(0);
  });

  it("should return max 100 for high activity", () => {
    const score = calculatePopularityScore({
      totalOrders: 500,
      totalQuantitySold: 2500,
      inventoryDepth: 250,
      availabilityStores: 10,
      daysSinceLastSale: 0,
    });
    expect(score).toBe(100);
  });

  it("caps at 100 even when availability exceeds the 10-store normalisation baseline", () => {
    // A regression guard: the original formula had no upper clamp on the
    // availability factor, so a SKU stocked in more than 10 stores could
    // push the total score above 100.
    const score = calculatePopularityScore({
      totalOrders: 500,
      totalQuantitySold: 2500,
      inventoryDepth: 250,
      availabilityStores: 25,
      daysSinceLastSale: 0,
    });
    expect(score).toBe(100);
  });

  it("should factor in recent sales heavily", () => {
    const recentSale = calculatePopularityScore({
      totalOrders: 10,
      totalQuantitySold: 10,
      inventoryDepth: 10,
      availabilityStores: 1,
      daysSinceLastSale: 0,
    });

    const oldSale = calculatePopularityScore({
      totalOrders: 10,
      totalQuantitySold: 10,
      inventoryDepth: 10,
      availabilityStores: 1,
      daysSinceLastSale: 30,
    });

    expect(recentSale).toBeGreaterThan(oldSale);
  });

  it("should scale factors proportionally", () => {
    const highInventory = calculatePopularityScore({
      totalOrders: 50,
      totalQuantitySold: 250,
      inventoryDepth: 100,
      availabilityStores: 5,
      daysSinceLastSale: 10,
    });

    const lowInventory = calculatePopularityScore({
      totalOrders: 50,
      totalQuantitySold: 250,
      inventoryDepth: 25,
      availabilityStores: 5,
      daysSinceLastSale: 10,
    });

    expect(highInventory).toBeGreaterThan(lowInventory);
  });
});
