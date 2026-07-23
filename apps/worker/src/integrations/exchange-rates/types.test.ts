import { describe, expect, it } from "vitest";

import { isRateStale } from "./types.js";
import type { ExchangeRate } from "./types.js";

function rateObservedAt(observedAt: string): ExchangeRate {
  return {
    provider: "test",
    baseCurrency: "USD",
    targetCurrency: "AUD",
    rate: 1.55,
    observedAt,
  };
}

describe("isRateStale", () => {
  const now = new Date("2026-07-23T12:00:00Z");
  const maxAgeMs = 24 * 60 * 60 * 1000; // 24 hours

  it("a rate observed well within the threshold is not stale", () => {
    const rate = rateObservedAt("2026-07-23T06:00:00Z"); // 6h old
    expect(isRateStale(rate, now, maxAgeMs)).toBe(false);
  });

  it("a rate observed well past the threshold is stale", () => {
    const rate = rateObservedAt("2026-07-20T12:00:00Z"); // 3 days old
    expect(isRateStale(rate, now, maxAgeMs)).toBe(true);
  });

  it("a rate observed exactly at the threshold boundary is stale (inclusive)", () => {
    const rate = rateObservedAt("2026-07-22T12:00:00Z"); // exactly 24h old
    expect(isRateStale(rate, now, maxAgeMs)).toBe(true);
  });

  it("a rate observed one millisecond within the threshold is not stale", () => {
    const rate = rateObservedAt("2026-07-22T12:00:00.001Z"); // 24h - 1ms old
    expect(isRateStale(rate, now, maxAgeMs)).toBe(false);
  });

  it("a rate observed in the future (clock skew) is not stale", () => {
    const rate = rateObservedAt("2026-07-23T13:00:00Z");
    expect(isRateStale(rate, now, maxAgeMs)).toBe(false);
  });
});
