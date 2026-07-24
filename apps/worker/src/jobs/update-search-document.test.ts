import { describe, expect, it, vi, beforeEach } from "vitest";

const mockFetchSkuSearchRows = vi.fn();
const mockUpsert = vi.fn();
const mockDelete = vi.fn();
const mockEnsureCardsCollectionExists = vi.fn().mockResolvedValue(undefined);
const mockCreateTypesenseClient = vi.fn().mockReturnValue({
  collections: () => ({
    documents: (id?: string) => (id ? { delete: mockDelete } : { upsert: mockUpsert }),
  }),
});

vi.mock("./fetch-sku-search-rows.js", () => ({
  fetchSkuSearchRows: (...args: unknown[]) => mockFetchSkuSearchRows(...args),
}));

vi.mock("@probable-winner/search", () => ({
  buildCardSearchDocument: (input: { skuId: string }) => ({ id: input.skuId }),
  createTypesenseClient: (...args: unknown[]) => mockCreateTypesenseClient(...args),
  ensureCardsCollectionExists: (...args: unknown[]) => mockEnsureCardsCollectionExists(...args),
  CARDS_COLLECTION_NAME: "cards",
}));

describe("updateSearchDocument", () => {
  const sql = {} as never;

  beforeEach(() => {
    mockFetchSkuSearchRows.mockReset();
    mockUpsert.mockReset();
    mockDelete.mockReset();
  });

  it("upserts the rebuilt document when the SKU is still active", async () => {
    mockFetchSkuSearchRows.mockResolvedValue([{ skuId: "sku-1" }]);
    mockUpsert.mockResolvedValue({ id: "sku-1" });

    const { updateSearchDocument } = await import("./update-search-document.js");
    const result = await updateSearchDocument(sql, "sku-1");

    expect(mockFetchSkuSearchRows).toHaveBeenCalledWith(sql, ["sku-1"]);
    expect(mockUpsert).toHaveBeenCalledWith({ id: "sku-1" });
    expect(mockDelete).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it("removes the document when the SKU no longer resolves (delisted/deleted)", async () => {
    mockFetchSkuSearchRows.mockResolvedValue([]);
    mockDelete.mockResolvedValue(undefined);

    const { updateSearchDocument } = await import("./update-search-document.js");
    const result = await updateSearchDocument(sql, "sku-gone");

    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it("doesn't throw when the document was already absent from the index", async () => {
    mockFetchSkuSearchRows.mockResolvedValue([]);
    mockDelete.mockRejectedValue(new Error("404 Not Found"));

    const { updateSearchDocument } = await import("./update-search-document.js");

    await expect(updateSearchDocument(sql, "sku-gone")).resolves.toBe(false);
  });
});
