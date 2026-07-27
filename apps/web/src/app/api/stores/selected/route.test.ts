import { describe, expect, it, vi, beforeEach } from "vitest";

const mockResolveDefaultStore = vi.fn();

vi.mock("@/lib/cart-session", () => ({
  resolveDefaultStore: () => mockResolveDefaultStore(),
}));

describe("GET /api/stores/selected", () => {
  beforeEach(() => {
    mockResolveDefaultStore.mockReset();
  });

  it("returns the resolved store's id", async () => {
    mockResolveDefaultStore.mockResolvedValue({ id: "store-1", organisation_id: "org-1" });
    const { GET } = await import("./route");

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ storeId: "store-1" });
  });

  it("returns a null storeId when no store currently accepts online orders", async () => {
    mockResolveDefaultStore.mockResolvedValue(null);
    const { GET } = await import("./route");

    const response = await GET();

    await expect(response.json()).resolves.toEqual({ storeId: null });
  });

  it("returns a 500 with an error message when resolution fails", async () => {
    mockResolveDefaultStore.mockRejectedValue(new Error("boom"));
    const { GET } = await import("./route");

    const response = await GET();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "boom" });
  });
});
