import { describe, it, expect, vi, beforeEach } from "vitest";

// createPendingOrder's own job is read-only validation (ownership, cart
// contents, price/reservation freshness) before handing the actual checkout
// conversion to the create_pending_order() database function in one RPC
// call -- the address/order/order_lines/order_allocations writes, and the
// click-and-collect re-reservation-at-the-chosen-store logic, all live in
// that function now (see 20260726040000_atomic_pending_order_creation.sql).
// These tests pin what this action sends the RPC, not the routing decision
// itself -- that's exercised by supabase/tests/database instead.
function chainable(result: { data: unknown; error: unknown }) {
  const obj: {
    then: (resolve: (value: unknown) => void) => void;
    select: () => typeof obj;
    eq: () => typeof obj;
    in: () => typeof obj;
    single: () => typeof obj;
  } = {
    then: (resolve) => resolve(result),
    select: () => obj,
    eq: () => obj,
    in: () => obj,
    single: () => obj,
  };
  return obj;
}

const NODE_STORE_A = "11111111-1111-1111-1111-111111111111";

let resultsByTable: Record<string, { data: unknown; error: unknown }> = {};
const mockRpc = vi.fn().mockResolvedValue({ data: { order_id: "order-1" }, error: null });
const mockFrom = vi.fn((table: string) => chainable(resultsByTable[table]));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: mockFrom, rpc: mockRpc }),
}));

vi.mock("@/server/checkout-ownership", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/checkout-ownership")>()),
  resolveCheckoutIdentity: () => Promise.resolve({ userId: "customer-1", guestToken: null }),
}));

function cartLine(skuId: string, nodeId: string, quantity: number) {
  return {
    id: `line-${skuId}`,
    sellable_sku_id: skuId,
    quantity,
    fulfilment_node_id: nodeId,
    inventory_reservation_id: `reservation-${skuId}`,
    inventory_reservations: { id: `reservation-${skuId}`, expires_at: null },
  };
}

function setUpCart(cartLines: ReturnType<typeof cartLine>[]) {
  resultsByTable = {
    carts: {
      data: {
        id: "cart-1",
        organisation_id: "org-1",
        customer_id: "customer-1",
        guest_token: null,
        cart_lines: cartLines,
      },
      error: null,
    },
    published_prices: {
      data: cartLines.map((line) => ({ sellable_sku_id: line.sellable_sku_id, final_amount: 10 })),
      error: null,
    },
  };
}

const DELIVERY_ADDRESS = {
  line1: "1 Test St",
  suburb: "Melbourne",
  state: "VIC",
  postcode: "3000",
};

describe("createPendingOrder", () => {
  beforeEach(() => {
    mockRpc.mockClear();
    mockRpc.mockResolvedValue({ data: { order_id: "order-1" }, error: null });
    mockFrom.mockClear();
  });

  it("calls create_pending_order with the identity, fulfilment type and address for delivery", async () => {
    setUpCart([cartLine("sku-1", NODE_STORE_A, 2)]);

    const { createPendingOrder } = await import("../create-pending-order");
    const result = await createPendingOrder("cart-1", "delivery", DELIVERY_ADDRESS);

    expect(result).toEqual({ success: true, orderId: "order-1" });
    expect(mockRpc).toHaveBeenCalledWith("create_pending_order", {
      p_cart_id: "cart-1",
      p_customer_id: "customer-1",
      p_guest_token: null,
      p_fulfilment_type: "online_shipping",
      p_address: DELIVERY_ADDRESS,
      p_collection_store_id: null,
    });
  });

  it("maps a collect order to click_and_collect with the chosen store id, no address", async () => {
    setUpCart([cartLine("sku-1", NODE_STORE_A, 1)]);

    const { createPendingOrder } = await import("../create-pending-order");
    const result = await createPendingOrder("cart-1", "collect", undefined, NODE_STORE_A);

    expect(result).toEqual({ success: true, orderId: "order-1" });
    expect(mockRpc).toHaveBeenCalledWith("create_pending_order", {
      p_cart_id: "cart-1",
      p_customer_id: "customer-1",
      p_guest_token: null,
      p_fulfilment_type: "click_and_collect",
      p_address: null,
      p_collection_store_id: NODE_STORE_A,
    });
  });

  it("surfaces a create_pending_order RPC failure (e.g. the collect store has no stock) as an order error", async () => {
    setUpCart([cartLine("sku-1", NODE_STORE_A, 1)]);
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "create_pending_order: insufficient available inventory for node ..." },
    });

    const { createPendingOrder } = await import("../create-pending-order");
    const result = await createPendingOrder("cart-1", "collect", undefined, NODE_STORE_A);

    expect(result.success).toBe(false);
    expect(result.errors).toEqual([
      {
        field: "order",
        message: "create_pending_order: insufficient available inventory for node ...",
      },
    ]);
  });

  it("never calls create_pending_order when the cart has no active price for a line", async () => {
    resultsByTable = {
      carts: {
        data: {
          id: "cart-1",
          organisation_id: "org-1",
          customer_id: "customer-1",
          guest_token: null,
          cart_lines: [cartLine("sku-1", NODE_STORE_A, 1)],
        },
        error: null,
      },
      published_prices: { data: [], error: null },
    };

    const { createPendingOrder } = await import("../create-pending-order");
    const result = await createPendingOrder("cart-1", "delivery", DELIVERY_ADDRESS);

    expect(result.success).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
