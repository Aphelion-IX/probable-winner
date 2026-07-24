import { describe, expect, it, vi, beforeEach } from "vitest";

// Isolated in its own file so mocking @/server/supabase and @/lib/cart-session
// works reliably -- same reasoning as add-all-to-cart.test.ts.
const mockRpc = vi.fn();
const mockGetUser = vi.fn();
const mockGetCartSessionId = vi.fn();

vi.mock("@/server/supabase", () => ({
  createServerSupabaseClient: () => ({
    auth: { getUser: mockGetUser },
    rpc: mockRpc,
  }),
}));

vi.mock("@/lib/cart-session", () => ({
  getCartSessionId: () => mockGetCartSessionId(),
}));

function rpcResult(result: { data: unknown; error: unknown }) {
  return Promise.resolve(result);
}

const ROW = {
  cart_line_id: "line-1",
  cart_id: "cart-1",
  sellable_sku_id: "sku-1",
  fulfilment_node_id: "node-1",
  quantity: 2,
  reservation_expires_at: "2026-08-01T00:00:00Z",
  card_name: "Lightning Bolt",
  set_code: "lea",
  rarity: "common",
  finish_code: "nonfoil",
  finish_name: "Nonfoil",
  condition_code: "nm",
  condition_name: "Near Mint",
  price: 12.5,
  currency: "AUD",
};

describe("getCartContents", () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockGetUser.mockReset();
    mockGetCartSessionId.mockReset();
    mockGetUser.mockResolvedValue({ data: { user: null } });
    mockGetCartSessionId.mockResolvedValue("11111111-1111-1111-1111-111111111111");
  });

  it("passes the guest token when there's no authenticated user", async () => {
    mockRpc.mockReturnValue(rpcResult({ data: [], error: null }));
    const { getCartContents } = await import("./get-cart-contents");

    await getCartContents();

    expect(mockRpc).toHaveBeenCalledWith("get_cart_contents", {
      p_guest_token: "11111111-1111-1111-1111-111111111111",
    });
  });

  it("passes no guest token when the user is authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "customer-1" } } });
    mockRpc.mockReturnValue(rpcResult({ data: [], error: null }));
    const { getCartContents } = await import("./get-cart-contents");

    await getCartContents();

    expect(mockRpc).toHaveBeenCalledWith("get_cart_contents", { p_guest_token: null });
  });

  it("maps rows into camelCase lines and computes the subtotal", async () => {
    mockRpc.mockReturnValue(rpcResult({ data: [ROW], error: null }));
    const { getCartContents } = await import("./get-cart-contents");

    const result = await getCartContents();

    expect(result).toEqual({
      cartId: "cart-1",
      subtotal: 25,
      lines: [
        {
          cartLineId: "line-1",
          cartId: "cart-1",
          sellableSkuId: "sku-1",
          fulfilmentNodeId: "node-1",
          quantity: 2,
          reservationExpiresAt: "2026-08-01T00:00:00Z",
          cardName: "Lightning Bolt",
          setCode: "lea",
          rarity: "common",
          finishCode: "nonfoil",
          finishName: "Nonfoil",
          conditionCode: "nm",
          conditionName: "Near Mint",
          price: 12.5,
          currency: "AUD",
        },
      ],
    });
  });

  it("returns an empty cart when there are no lines", async () => {
    mockRpc.mockReturnValue(rpcResult({ data: [], error: null }));
    const { getCartContents } = await import("./get-cart-contents");

    const result = await getCartContents();

    expect(result).toEqual({ cartId: null, lines: [], subtotal: 0 });
  });

  it("throws with the database error message on failure", async () => {
    mockRpc.mockReturnValue(rpcResult({ data: null, error: { message: "boom" } }));
    const { getCartContents } = await import("./get-cart-contents");

    await expect(getCartContents()).rejects.toThrow("Failed to load cart: boom");
  });
});
