import { describe, expect, it, vi, beforeEach } from "vitest";

// Isolated in its own file so mocking @/server/supabase works reliably —
// same reasoning as add-all-to-cart.test.ts.
const mockReturns = vi.fn();
const mockLimit = vi.fn().mockReturnValue({ returns: mockReturns });
const mockOrder = vi.fn().mockReturnValue({ limit: mockLimit });
const mockEq = vi.fn().mockReturnValue({ order: mockOrder });
const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });
const mockRpc = vi.fn();

vi.mock("@/server/supabase", () => ({
  createServerSupabaseClient: () => ({ from: mockFrom, rpc: mockRpc }),
}));

describe("getPricingReviewQueue", () => {
  beforeEach(() => {
    mockReturns.mockReset();
  });

  it("maps calculated_prices rows to the flattened review-queue shape", async () => {
    mockReturns.mockResolvedValue({
      data: [
        {
          id: "calc-1",
          status: "suggested",
          base_amount: 10,
          base_currency: "USD",
          final_amount: 20.15,
          currency: "AUD",
          calculated_at: "2026-07-24T00:00:00Z",
          pricing_rule: { name: "Default TCGplayer" },
          sellable_sku: {
            card_printing: {
              collector_number: "117",
              oracle_card: { name: "Lightning Bolt" },
              set: { code: "2X2" },
            },
          },
        },
      ],
      error: null,
    });

    const { getPricingReviewQueue } = await import("./manage-pricing-review");
    const result = await getPricingReviewQueue();

    expect(result).toEqual([
      {
        id: "calc-1",
        status: "suggested",
        base_amount: 10,
        base_currency: "USD",
        final_amount: 20.15,
        currency: "AUD",
        calculated_at: "2026-07-24T00:00:00Z",
        rule_name: "Default TCGplayer",
        card_name: "Lightning Bolt",
        set_code: "2X2",
        collector_number: "117",
      },
    ]);
    expect(mockEq).toHaveBeenCalledWith("status", "suggested");
  });

  it("handles nested relations returned as arrays instead of single objects", async () => {
    mockReturns.mockResolvedValue({
      data: [
        {
          id: "calc-2",
          status: "suggested",
          base_amount: 5,
          base_currency: "USD",
          final_amount: 12,
          currency: "AUD",
          calculated_at: "2026-07-24T00:00:00Z",
          pricing_rule: [{ name: "Rule A" }],
          sellable_sku: {
            card_printing: {
              collector_number: "42",
              oracle_card: [{ name: "Counterspell" }],
              set: [{ code: "MH2" }],
            },
          },
        },
      ],
      error: null,
    });

    const { getPricingReviewQueue } = await import("./manage-pricing-review");
    const result = await getPricingReviewQueue();

    expect(result[0].rule_name).toBe("Rule A");
    expect(result[0].card_name).toBe("Counterspell");
    expect(result[0].set_code).toBe("MH2");
  });

  it("throws a clear error when the query fails", async () => {
    mockReturns.mockResolvedValue({ data: null, error: { message: "connection refused" } });

    const { getPricingReviewQueue } = await import("./manage-pricing-review");

    await expect(getPricingReviewQueue()).rejects.toThrow("Failed to fetch pricing review queue");
  });
});

describe("approvePrice / overridePrice / rejectPrice", () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it("approvePrice calls approve_suggested_price with the calculated_price_id", async () => {
    mockRpc.mockResolvedValue({ error: null });
    const { approvePrice } = await import("./manage-pricing-review");

    await approvePrice("calc-1");

    expect(mockRpc).toHaveBeenCalledWith("approve_suggested_price", {
      calculated_price_id: "calc-1",
    });
  });

  it("overridePrice calls override_suggested_price with the id and amount", async () => {
    mockRpc.mockResolvedValue({ error: null });
    const { overridePrice } = await import("./manage-pricing-review");

    await overridePrice("calc-1", 25);

    expect(mockRpc).toHaveBeenCalledWith("override_suggested_price", {
      calculated_price_id: "calc-1",
      override_amount: 25,
    });
  });

  it("rejectPrice calls reject_suggested_price with the calculated_price_id", async () => {
    mockRpc.mockResolvedValue({ error: null });
    const { rejectPrice } = await import("./manage-pricing-review");

    await rejectPrice("calc-1");

    expect(mockRpc).toHaveBeenCalledWith("reject_suggested_price", {
      calculated_price_id: "calc-1",
    });
  });

  it("surfaces a permission-denied RPC error (e.g. missing pricing.approve) to the caller", async () => {
    mockRpc.mockResolvedValue({
      error: { message: "approve_suggested_price: pricing.approve permission required" },
    });
    const { approvePrice } = await import("./manage-pricing-review");

    await expect(approvePrice("calc-1")).rejects.toThrow(
      "approve_suggested_price: pricing.approve permission required",
    );
  });
});
