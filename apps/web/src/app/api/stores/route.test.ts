import { describe, expect, it, vi, beforeEach } from "vitest";

const mockListActiveStores = vi.fn();

vi.mock("@/features/customer/queries/list-active-stores", () => ({
  listActiveStores: () => mockListActiveStores(),
}));

describe("GET /api/stores", () => {
  beforeEach(() => {
    mockListActiveStores.mockReset();
  });

  it("returns the active stores as JSON", async () => {
    const stores = [{ id: "store-1", name: "Flagship", code: "flag", region: "VIC" }];
    mockListActiveStores.mockResolvedValue(stores);
    const { GET } = await import("./route");

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(stores);
  });

  it("returns a 500 with an error message when the query fails", async () => {
    mockListActiveStores.mockRejectedValue(new Error("boom"));
    const { GET } = await import("./route");

    const response = await GET();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "boom" });
  });
});
