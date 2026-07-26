import { describe, it, expect, vi, beforeEach } from "vitest";

// Proves the webhook only tells Stripe an event was "received" when it
// actually finished durable processing (2026-07-26 security re-audit item
// 7/6). A 200 on an RPC failure would stop Stripe from ever retrying,
// leaving a paid order stuck 'pending' with its reservation unconverted, or
// a failed order's stock stuck reserved.
const mockConstructEvent = vi.fn();
const mockRpc = vi.fn();

vi.mock("stripe", () => ({
  default: class {
    webhooks = { constructEvent: (...args: unknown[]) => mockConstructEvent(...args) };
  },
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ rpc: mockRpc }),
}));

function request(body: string): Request {
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": "sig_test" },
    body,
  });
}

function stripeEvent(type: string, data: Record<string, unknown>, id = "evt_1") {
  return { id, type, data: { object: data } };
}

describe("POST /api/webhooks/stripe", () => {
  beforeEach(() => {
    mockConstructEvent.mockReset();
    mockRpc.mockReset();
  });

  it("rejects a request with no stripe-signature header", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/webhooks/stripe", { method: "POST", body: "{}" }),
    );

    expect(response.status).toBe(400);
    expect(mockConstructEvent).not.toHaveBeenCalled();
  });

  it("rejects a request with an invalid signature", async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error("invalid signature");
    });
    const { POST } = await import("./route");

    const response = await POST(request("{}"));

    expect(response.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("returns 200 when confirm_order_payment succeeds", async () => {
    mockConstructEvent.mockReturnValue(
      stripeEvent("checkout.session.completed", { metadata: { orderId: "order-1" } }),
    );
    mockRpc.mockResolvedValue({ data: { status: "confirmed" }, error: null });
    const { POST } = await import("./route");

    const response = await POST(request("{}"));

    expect(response.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("confirm_order_payment", {
      p_order_id: "order-1",
      p_stripe_event_id: "evt_1",
    });
  });

  it("returns 500 (not 200) when confirm_order_payment fails, so Stripe retries", async () => {
    mockConstructEvent.mockReturnValue(
      stripeEvent("checkout.session.completed", { metadata: { orderId: "order-1" } }),
    );
    mockRpc.mockResolvedValue({ data: null, error: { message: "reservation is not active" } });
    const { POST } = await import("./route");

    const response = await POST(request("{}"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      received: false,
      error: "reservation is not active",
    });
  });

  it("returns 500 (not 200) when release_failed_order_reservations fails", async () => {
    mockConstructEvent.mockReturnValue(
      stripeEvent("checkout.session.expired", { metadata: { orderId: "order-1" } }),
    );
    mockRpc.mockResolvedValue({ data: null, error: { message: "order not found" } });
    const { POST } = await import("./route");

    const response = await POST(request("{}"));

    expect(response.status).toBe(500);
    expect(mockRpc).toHaveBeenCalledWith("release_failed_order_reservations", {
      p_order_id: "order-1",
    });
  });

  it("returns 200 for an event type it doesn't act on", async () => {
    mockConstructEvent.mockReturnValue(stripeEvent("payment_intent.created", {}));
    const { POST } = await import("./route");

    const response = await POST(request("{}"));

    expect(response.status).toBe(200);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
