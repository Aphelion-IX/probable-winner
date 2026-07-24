import { describe, expect, it, vi, beforeEach } from "vitest";

// Isolated in its own file so mocking @/server/supabase works reliably —
// same reasoning as match-decklist-lines-batching.test.ts.
const mockMaybeSingle = vi.fn();
const mockLimit = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
const mockEqOnline = vi.fn().mockReturnValue({ limit: mockLimit });
const mockEqActive = vi.fn().mockReturnValue({ eq: mockEqOnline });
const mockSelect = vi.fn().mockReturnValue({ eq: mockEqActive });
const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });
const mockGetUser = vi.fn().mockResolvedValue({ data: { user: null } });
const mockRpc = vi.fn();

vi.mock("@/server/supabase", () => ({
  createServerSupabaseClient: () => ({
    from: mockFrom,
    auth: { getUser: mockGetUser },
    rpc: mockRpc,
  }),
}));

vi.mock("@/lib/cart-session", () => ({
  getCartSessionId: vi.fn().mockResolvedValue("11111111-1111-1111-1111-111111111111"),
}));

const STORE = { id: "store-1", organisation_id: "org-1" };
const CART = { id: "cart-1" };

describe("addAllToCart", () => {
  beforeEach(() => {
    mockMaybeSingle.mockReset();
    mockGetUser.mockClear();
    mockRpc.mockReset();
  });

  it("returns an error without touching the database for an empty list", async () => {
    const { addAllToCart } = await import("./add-all-to-cart");

    const result = await addAllToCart([]);

    expect(result).toEqual({ status: "error", message: "Nothing to add." });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("returns an error when no store accepts online orders", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    const { addAllToCart } = await import("./add-all-to-cart");

    const result = await addAllToCart([{ skuId: "sku-1", quantity: 4 }]);

    expect(result).toEqual({
      status: "error",
      message: "No store currently accepts online orders.",
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("creates a guest cart and adds every line, reporting a full success", async () => {
    mockMaybeSingle.mockResolvedValue({ data: STORE, error: null });
    mockRpc.mockImplementation((fn: string) => {
      if (fn === "get_or_create_cart") return Promise.resolve({ data: CART, error: null });
      return Promise.resolve({ data: {}, error: null });
    });

    const { addAllToCart } = await import("./add-all-to-cart");

    const result = await addAllToCart([
      { skuId: "sku-1", quantity: 4 },
      { skuId: "sku-2", quantity: 2 },
    ]);

    expect(result).toEqual({ status: "success", addedCount: 2, failedCount: 0 });
    expect(mockRpc).toHaveBeenCalledWith("get_or_create_cart", {
      p_organisation_id: "org-1",
      p_customer_id: null,
      p_guest_token: "11111111-1111-1111-1111-111111111111",
    });
    expect(mockRpc).toHaveBeenCalledWith("add_to_cart", {
      p_cart_id: "cart-1",
      p_fulfilment_node_id: "store-1",
      p_sellable_sku_id: "sku-1",
      p_quantity: 4,
    });
    expect(mockRpc).toHaveBeenCalledWith("add_to_cart", {
      p_cart_id: "cart-1",
      p_fulfilment_node_id: "store-1",
      p_sellable_sku_id: "sku-2",
      p_quantity: 2,
    });
  });

  it("uses the authenticated customer id instead of a guest token when signed in", async () => {
    mockMaybeSingle.mockResolvedValue({ data: STORE, error: null });
    mockGetUser.mockResolvedValue({ data: { user: { id: "customer-1" } } });
    mockRpc.mockImplementation((fn: string) => {
      if (fn === "get_or_create_cart") return Promise.resolve({ data: CART, error: null });
      return Promise.resolve({ data: {}, error: null });
    });

    const { addAllToCart } = await import("./add-all-to-cart");

    await addAllToCart([{ skuId: "sku-1", quantity: 1 }]);

    expect(mockRpc).toHaveBeenCalledWith("get_or_create_cart", {
      p_organisation_id: "org-1",
      p_customer_id: "customer-1",
      p_guest_token: null,
    });
  });

  it("reports a partial success when some lines fail to reserve", async () => {
    mockMaybeSingle.mockResolvedValue({ data: STORE, error: null });
    mockRpc.mockImplementation((fn: string, args: Record<string, unknown>) => {
      if (fn === "get_or_create_cart") return Promise.resolve({ data: CART, error: null });
      if (args.p_sellable_sku_id === "sku-out-of-stock") {
        return Promise.resolve({ data: null, error: { message: "insufficient stock" } });
      }
      return Promise.resolve({ data: {}, error: null });
    });

    const { addAllToCart } = await import("./add-all-to-cart");

    const result = await addAllToCart([
      { skuId: "sku-1", quantity: 4 },
      { skuId: "sku-out-of-stock", quantity: 2 },
    ]);

    expect(result).toEqual({ status: "success", addedCount: 1, failedCount: 1 });
  });

  it("returns an error when the cart itself can't be created", async () => {
    mockMaybeSingle.mockResolvedValue({ data: STORE, error: null });
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });

    const { addAllToCart } = await import("./add-all-to-cart");

    const result = await addAllToCart([{ skuId: "sku-1", quantity: 1 }]);

    expect(result).toEqual({ status: "error", message: "Couldn't start a cart: boom" });
  });
});
