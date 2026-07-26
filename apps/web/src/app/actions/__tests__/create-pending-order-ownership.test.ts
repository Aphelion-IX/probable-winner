import { describe, it, expect, vi, beforeEach } from "vitest";

// Proves the checkout IDOR is closed: createPendingOrder must refuse a cart
// id the caller does not own, before ever calling create_pending_order()
// (the database function that actually converts the cart into an order).
// Kept separate from create-pending-order.test.ts (RPC parameter mapping)
// because the identity mock differs per test here.
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

const NODE = "11111111-1111-1111-1111-111111111111";

let resultsByTable: Record<string, { data: unknown; error: unknown }> = {};
const mockRpc = vi.fn().mockResolvedValue({ data: { order_id: "order-1" }, error: null });
const mockFrom = vi.fn((table: string) => chainable(resultsByTable[table]));
const mockResolveIdentity = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: mockFrom, rpc: mockRpc }),
}));

vi.mock("@/server/checkout-ownership", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/checkout-ownership")>()),
  resolveCheckoutIdentity: () => mockResolveIdentity(),
}));

function setUpCart(owner: { customer_id: string | null; guest_token: string | null }) {
  resultsByTable = {
    carts: {
      data: {
        id: "cart-1",
        organisation_id: "org-1",
        ...owner,
        cart_lines: [
          {
            id: "line-1",
            sellable_sku_id: "sku-1",
            quantity: 1,
            fulfilment_node_id: NODE,
            inventory_reservation_id: "reservation-1",
            inventory_reservations: { id: "reservation-1", expires_at: null },
          },
        ],
      },
      error: null,
    },
    published_prices: {
      data: [{ sellable_sku_id: "sku-1", final_amount: 10 }],
      error: null,
    },
  };
}

const DELIVERY_ADDRESS = {
  line1: "1 Test St",
  suburb: "Testville",
  state: "VIC",
  postcode: "3000",
};

describe("createPendingOrder ownership (checkout IDOR)", () => {
  beforeEach(() => {
    mockRpc.mockClear();
    mockRpc.mockResolvedValue({ data: { order_id: "order-1" }, error: null });
    mockFrom.mockClear();
    mockResolveIdentity.mockReset();
  });

  it("refuses another customer's cart without creating an order", async () => {
    setUpCart({ customer_id: "victim", guest_token: null });
    mockResolveIdentity.mockResolvedValue({ userId: "attacker", guestToken: null });
    const { createPendingOrder } = await import("../create-pending-order");

    const result = await createPendingOrder("cart-1", "delivery", DELIVERY_ADDRESS);

    expect(result.success).toBe(false);
    // Same message as a genuinely missing cart — existence must not leak.
    expect(result.errors).toEqual([{ field: "cart", message: "Cart not found" }]);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("refuses another guest's cart", async () => {
    setUpCart({ customer_id: null, guest_token: "victim-token" });
    mockResolveIdentity.mockResolvedValue({ userId: null, guestToken: "attacker-token" });
    const { createPendingOrder } = await import("../create-pending-order");

    const result = await createPendingOrder("cart-1", "delivery", DELIVERY_ADDRESS);

    expect(result.success).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("refuses a guest cart when the caller holds no cookie at all", async () => {
    setUpCart({ customer_id: null, guest_token: "victim-token" });
    mockResolveIdentity.mockResolvedValue({ userId: null, guestToken: null });
    const { createPendingOrder } = await import("../create-pending-order");

    expect((await createPendingOrder("cart-1", "delivery", DELIVERY_ADDRESS)).success).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("allows the owning customer through and creates the order", async () => {
    setUpCart({ customer_id: "customer-1", guest_token: null });
    mockResolveIdentity.mockResolvedValue({ userId: "customer-1", guestToken: null });
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

  it("allows the owning guest through", async () => {
    setUpCart({ customer_id: null, guest_token: "token-1" });
    mockResolveIdentity.mockResolvedValue({ userId: null, guestToken: "token-1" });
    const { createPendingOrder } = await import("../create-pending-order");

    expect((await createPendingOrder("cart-1", "delivery", DELIVERY_ADDRESS)).success).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith(
      "create_pending_order",
      expect.objectContaining({ p_customer_id: null, p_guest_token: "token-1" }),
    );
  });
});
