import { describe, it, expect, vi, beforeEach } from "vitest";

// Proves the payment-initiation IDOR is closed: the route must refuse an
// order id the caller does not own, before any Stripe session is created.
function chainable(result: { data: unknown; error: unknown }) {
  const obj: {
    then: (resolve: (value: unknown) => void) => void;
    select: () => typeof obj;
    eq: () => typeof obj;
    single: () => typeof obj;
  } = {
    then: (resolve) => resolve(result),
    select: () => obj,
    eq: () => obj,
    single: () => obj,
  };
  return obj;
}

let resultsByTable: Record<string, { data: unknown; error: unknown }> = {};
const mockFrom = vi.fn((table: string) => chainable(resultsByTable[table]));
const mockSessionsCreate = vi.fn();
const mockResolveIdentity = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: mockFrom }),
}));

vi.mock("stripe", () => ({
  default: class {
    checkout = { sessions: { create: (...args: unknown[]) => mockSessionsCreate(...args) } };
  },
}));

vi.mock("@/server/checkout-ownership", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/checkout-ownership")>()),
  resolveCheckoutIdentity: () => mockResolveIdentity(),
}));

function setUpOrder(order: {
  customer_id: string | null;
  guest_token: string | null;
  status?: string;
}) {
  resultsByTable = {
    orders: {
      data: { id: "order-1", status: order.status ?? "pending", ...order },
      error: null,
    },
    order_lines: {
      data: [
        {
          id: "line-1",
          sellable_sku_id: "sku-1",
          quantity: 1,
          unit_price: 10,
          sellable_skus: { id: "sku-1", card_printings: null },
        },
      ],
      error: null,
    },
  };
}

function request(orderId: string): Request {
  return new Request("http://localhost/api/checkout/sessions", {
    method: "POST",
    body: JSON.stringify({ orderId }),
  });
}

describe("POST /api/checkout/sessions ownership", () => {
  beforeEach(() => {
    mockFrom.mockClear();
    mockSessionsCreate.mockReset();
    mockSessionsCreate.mockResolvedValue({ url: "https://stripe.test/session" });
    mockResolveIdentity.mockReset();
  });

  it("refuses another customer's order with a 404 and no Stripe session", async () => {
    setUpOrder({ customer_id: "victim", guest_token: null });
    mockResolveIdentity.mockResolvedValue({ userId: "attacker", guestToken: null });
    const { POST } = await import("./route");

    const response = await POST(request("order-1"));

    expect(response.status).toBe(404);
    // Same shape as a missing order — existence must not leak.
    await expect(response.json()).resolves.toEqual({ success: false, error: "Order not found" });
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  it("refuses another guest's order", async () => {
    setUpOrder({ customer_id: null, guest_token: "victim-token" });
    mockResolveIdentity.mockResolvedValue({ userId: null, guestToken: "attacker-token" });
    const { POST } = await import("./route");

    expect((await POST(request("order-1"))).status).toBe(404);
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  it("refuses an ownerless legacy order", async () => {
    setUpOrder({ customer_id: null, guest_token: null });
    mockResolveIdentity.mockResolvedValue({ userId: "someone", guestToken: null });
    const { POST } = await import("./route");

    expect((await POST(request("order-1"))).status).toBe(404);
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  it("refuses to re-open payment on an order that is no longer pending", async () => {
    setUpOrder({ customer_id: "customer-1", guest_token: null, status: "paid" });
    mockResolveIdentity.mockResolvedValue({ userId: "customer-1", guestToken: null });
    const { POST } = await import("./route");

    const response = await POST(request("order-1"));

    expect(response.status).toBe(409);
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  it("creates a Stripe session for the owning customer", async () => {
    setUpOrder({ customer_id: "customer-1", guest_token: null });
    mockResolveIdentity.mockResolvedValue({ userId: "customer-1", guestToken: null });
    const { POST } = await import("./route");

    const response = await POST(request("order-1"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      sessionUrl: "https://stripe.test/session",
    });
    expect(mockSessionsCreate).toHaveBeenCalledTimes(1);
  });

  it("creates a Stripe session for the owning guest", async () => {
    setUpOrder({ customer_id: null, guest_token: "token-1" });
    mockResolveIdentity.mockResolvedValue({ userId: null, guestToken: "token-1" });
    const { POST } = await import("./route");

    expect((await POST(request("order-1"))).status).toBe(200);
    expect(mockSessionsCreate).toHaveBeenCalledTimes(1);
  });
});
