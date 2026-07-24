import { describe, expect, it, beforeEach } from "vitest";
import { checkRateLimit, _resetRateLimitState } from "./rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => {
    _resetRateLimitState();
  });

  it("allows requests under the limit", () => {
    const rule = { windowMs: 60_000, max: 3 };
    const now = 1_000_000;

    const first = checkRateLimit("search", "1.2.3.4", rule, now);
    const second = checkRateLimit("search", "1.2.3.4", rule, now + 10);
    const third = checkRateLimit("search", "1.2.3.4", rule, now + 20);

    expect(first.limited).toBe(false);
    expect(second.limited).toBe(false);
    expect(third.limited).toBe(false);
    expect(third.remaining).toBe(0);
  });

  it("blocks the request that exceeds the limit — a defined error, not a crash", () => {
    const rule = { windowMs: 60_000, max: 2 };
    const now = 1_000_000;

    checkRateLimit("search", "1.2.3.4", rule, now);
    checkRateLimit("search", "1.2.3.4", rule, now + 10);
    const fourth = checkRateLimit("search", "1.2.3.4", rule, now + 20);

    expect(fourth.limited).toBe(true);
    expect(fourth.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("resets once the window has elapsed", () => {
    const rule = { windowMs: 1000, max: 1 };
    const now = 1_000_000;

    const first = checkRateLimit("search", "1.2.3.4", rule, now);
    const blocked = checkRateLimit("search", "1.2.3.4", rule, now + 500);
    const afterWindow = checkRateLimit("search", "1.2.3.4", rule, now + 1500);

    expect(first.limited).toBe(false);
    expect(blocked.limited).toBe(true);
    expect(afterWindow.limited).toBe(false);
  });

  it("tracks each client independently — one client's burst never blocks another", () => {
    const rule = { windowMs: 60_000, max: 1 };
    const now = 1_000_000;

    const clientA = checkRateLimit("search", "1.1.1.1", rule, now);
    const clientAAgain = checkRateLimit("search", "1.1.1.1", rule, now + 10);
    const clientB = checkRateLimit("search", "2.2.2.2", rule, now + 10);

    expect(clientA.limited).toBe(false);
    expect(clientAAgain.limited).toBe(true);
    expect(clientB.limited).toBe(false);
  });

  it("tracks each bucket independently — search traffic never eats a client's checkout budget", () => {
    const searchRule = { windowMs: 60_000, max: 1 };
    const checkoutRule = { windowMs: 60_000, max: 1 };
    const now = 1_000_000;

    const search = checkRateLimit("search", "1.1.1.1", searchRule, now);
    const searchAgain = checkRateLimit("search", "1.1.1.1", searchRule, now + 10);
    const checkout = checkRateLimit("checkout", "1.1.1.1", checkoutRule, now + 10);

    expect(search.limited).toBe(false);
    expect(searchAgain.limited).toBe(true);
    expect(checkout.limited).toBe(false);
  });

  it("simulates 1000 distinct clients bursting the same endpoint without blocking each other", () => {
    // Mirrors blueprint §23's "hot card under contention" scenario: many
    // different customers hitting checkout for the same popular card at
    // once. Per-client limiting means none of them should trip another's
    // budget.
    const rule = { windowMs: 60_000, max: 20 };
    const now = 1_000_000;

    for (let i = 0; i < 1000; i++) {
      const clientId = `10.0.0.${i}`;
      const result = checkRateLimit("checkout", clientId, rule, now);
      expect(result.limited).toBe(false);
    }
  });
});
