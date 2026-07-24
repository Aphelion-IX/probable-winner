import { describe, it, expect, vi } from "vitest";

// addToCart calls the real Supabase client, which makes a genuine network
// request -- unmocked, this hangs on DNS resolution against whatever
// NEXT_PUBLIC_SUPABASE_URL happens to be set to (fast-failing in some
// sandboxes, but slow enough to hit vitest's default timeout on a real
// runner). Mock the client so this test is deterministic and fast
// everywhere, matching this file's actual intent: verifying the action
// returns a well-shaped result, not exercising real Supabase behaviour.
const mockSingle = vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } });
const mockEq = vi.fn().mockReturnValue({ single: mockSingle });
const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: mockFrom }),
}));

describe("addToCart", () => {
  it("should export addToCart function", async () => {
    const { addToCart } = await import("../add-to-cart");
    expect(typeof addToCart).toBe("function");
  });

  it("should return result object", async () => {
    const { addToCart } = await import("../add-to-cart");
    const result = await addToCart("cart-id", "sku-id", 1, "node-id");
    expect(result).toHaveProperty("success");
    expect(result.success).toBe(false);
    expect(result).toHaveProperty("error");
  });
});
