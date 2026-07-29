import { describe, expect, it, vi, beforeEach } from "vitest";

const mockRpc = vi.fn();

vi.mock("@/server/supabase", () => ({
  createServerSupabaseClient: () => ({ rpc: mockRpc }),
}));

// Grouping/lookup logic now lives in the get_sku_live_data() database
// function (see
// supabase/migrations/20260729043229_get_sku_live_data_function.sql) --
// these tests only need to check that getSkuLiveData() calls it correctly
// and maps its snake_case row (or absence of one) back to SkuLiveData/null.
describe("getSkuLiveData", () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it("calls the RPC with the requested sku id", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    const { getSkuLiveData } = await import("./get-sku-live-data");

    await getSkuLiveData("sku-1");

    expect(mockRpc).toHaveBeenCalledWith("get_sku_live_data", { p_sku_id: "sku-1" });
  });

  it("returns null when the RPC returns no rows (sku not found)", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    const { getSkuLiveData } = await import("./get-sku-live-data");

    expect(await getSkuLiveData("missing-sku")).toBeNull();
  });

  it("throws when the RPC errors", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { getSkuLiveData } = await import("./get-sku-live-data");

    await expect(getSkuLiveData("sku-1")).rejects.toThrow("Failed to look up SKU: boom");
  });

  it("maps a found row, including a null price/currency when there's no active price", async () => {
    mockRpc.mockResolvedValue({
      data: [{ sku_id: "sku-1", price: null, currency: null, available_quantity: 3 }],
      error: null,
    });
    const { getSkuLiveData } = await import("./get-sku-live-data");

    expect(await getSkuLiveData("sku-1")).toEqual({
      skuId: "sku-1",
      price: null,
      currency: null,
      availableQuantity: 3,
    });
  });

  it("maps a priced, in-stock row", async () => {
    mockRpc.mockResolvedValue({
      data: [{ sku_id: "sku-1", price: 12.5, currency: "AUD", available_quantity: 7 }],
      error: null,
    });
    const { getSkuLiveData } = await import("./get-sku-live-data");

    expect(await getSkuLiveData("sku-1")).toEqual({
      skuId: "sku-1",
      price: 12.5,
      currency: "AUD",
      availableQuantity: 7,
    });
  });
});
