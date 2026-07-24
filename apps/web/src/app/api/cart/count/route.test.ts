import { describe, expect, it, vi, beforeEach } from "vitest";

const mockGetCartContents = vi.fn();

vi.mock("@/features/cart/queries/get-cart-contents", () => ({
  getCartContents: () => mockGetCartContents(),
}));

describe("GET /api/cart/count", () => {
  beforeEach(() => {
    mockGetCartContents.mockReset();
  });

  it("returns the sum of line quantities", async () => {
    mockGetCartContents.mockResolvedValue({
      cartId: "cart-1",
      subtotal: 30,
      lines: [
        { cartLineId: "line-1", quantity: 2 },
        { cartLineId: "line-2", quantity: 3 },
      ],
    });
    const { GET } = await import("./route");

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ count: 5 });
  });

  it("returns 0 for an empty cart", async () => {
    mockGetCartContents.mockResolvedValue({ cartId: null, subtotal: 0, lines: [] });
    const { GET } = await import("./route");

    const response = await GET();

    await expect(response.json()).resolves.toEqual({ count: 0 });
  });

  it("returns a 500 with an error message when the query fails", async () => {
    mockGetCartContents.mockRejectedValue(new Error("boom"));
    const { GET } = await import("./route");

    const response = await GET();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "boom" });
  });
});
