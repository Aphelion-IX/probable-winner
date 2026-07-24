import { describe, expect, it, vi, beforeEach } from "vitest";

// Isolated in its own file so mocking @/server/supabase and @/lib/cart-session
// works reliably -- same reasoning as add-all-to-cart.test.ts.
const mockRpc = vi.fn();
const mockResolveDefaultStore = vi.fn();
const mockGetOrCreateCart = vi.fn();

vi.mock("@/server/supabase", () => ({
  createServerSupabaseClient: () => ({ rpc: mockRpc }),
}));

vi.mock("@/lib/cart-session", () => ({
  resolveDefaultStore: () => mockResolveDefaultStore(),
  getOrCreateCart: (organisationId: string) => mockGetOrCreateCart(organisationId),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const STORE = { id: "store-1", organisation_id: "org-1" };
const CART = { id: "cart-1" };

describe("addToCart", () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockResolveDefaultStore.mockReset();
    mockGetOrCreateCart.mockReset();
  });

  it("rejects a non-positive quantity without touching the database", async () => {
    const { addToCart } = await import("../add-to-cart");

    const result = await addToCart("sku-1", 0);

    expect(result).toEqual({
      success: false,
      error: "Quantity must be a positive whole number",
    });
    expect(mockResolveDefaultStore).not.toHaveBeenCalled();
  });

  it("returns an error when no store accepts online orders", async () => {
    mockResolveDefaultStore.mockResolvedValue(null);
    const { addToCart } = await import("../add-to-cart");

    const result = await addToCart("sku-1", 1);

    expect(result).toEqual({
      success: false,
      error: "No store currently accepts online orders",
    });
    expect(mockGetOrCreateCart).not.toHaveBeenCalled();
  });

  it("adds the SKU via the atomic add_to_cart RPC and returns the new cart line id", async () => {
    mockResolveDefaultStore.mockResolvedValue(STORE);
    mockGetOrCreateCart.mockResolvedValue(CART);
    mockRpc.mockResolvedValue({ data: { id: "line-1" }, error: null });

    const { addToCart } = await import("../add-to-cart");

    const result = await addToCart("sku-1", 3);

    expect(mockGetOrCreateCart).toHaveBeenCalledWith("org-1");
    expect(mockRpc).toHaveBeenCalledWith("add_to_cart", {
      p_cart_id: "cart-1",
      p_fulfilment_node_id: "store-1",
      p_sellable_sku_id: "sku-1",
      p_quantity: 3,
    });
    expect(result).toEqual({ success: true, cartLineId: "line-1" });
  });

  it("surfaces an RPC error (e.g. insufficient stock) instead of a generic failure", async () => {
    mockResolveDefaultStore.mockResolvedValue(STORE);
    mockGetOrCreateCart.mockResolvedValue(CART);
    mockRpc.mockResolvedValue({ data: null, error: { message: "insufficient stock" } });

    const { addToCart } = await import("../add-to-cart");

    const result = await addToCart("sku-1", 3);

    expect(result).toEqual({ success: false, error: "insufficient stock" });
  });

  it("catches a thrown error from cart resolution and returns it as a result", async () => {
    mockResolveDefaultStore.mockResolvedValue(STORE);
    mockGetOrCreateCart.mockRejectedValue(new Error("boom"));

    const { addToCart } = await import("../add-to-cart");

    const result = await addToCart("sku-1", 1);

    expect(result).toEqual({ success: false, error: "boom" });
  });
});
