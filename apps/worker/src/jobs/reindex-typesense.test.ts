import { describe, expect, it, vi, beforeEach } from "vitest";

// Isolated mocking (no live Postgres/Typesense reachable in this sandbox):
// both the batched Postgres read and the Typesense client are faked so the
// job's own control flow (batching, success/failure counting, error
// handling) is what's actually under test.
const mockFetchSkuSearchRows = vi.fn();
const mockImport = vi.fn();
const mockEnsureCardsCollectionExists = vi.fn().mockResolvedValue(undefined);
const mockCreateTypesenseClient = vi.fn().mockReturnValue({
  collections: () => ({ documents: () => ({ import: mockImport }) }),
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

function fakeRow(skuId: string) {
  return {
    skuId,
    oracleCardId: "oracle-1",
    name: "Lightning Bolt",
    typeLine: "Instant",
    manaCost: "{R}",
    cmc: 1,
    colorIdentity: ["R"],
    setCode: "2X2",
    setName: "Double Masters 2022",
    collectorNumber: "117",
    rarity: "uncommon",
    artistName: "Christopher Rush",
    imageUrl: null,
    finishCode: "nonfoil",
    conditionCode: "nm",
    languageCode: "en",
    legality: {},
    priceAmount: 1.5,
    priceCurrency: "AUD",
    quantityAvailable: 4,
    quantityInStores: {},
  };
}

describe("reindexTypesense", () => {
  const sql = {} as never;

  beforeEach(() => {
    mockFetchSkuSearchRows.mockReset();
    mockImport.mockReset();
    mockEnsureCardsCollectionExists.mockClear();
    mockCreateTypesenseClient.mockClear();
  });

  it("ensures the collection exists and upserts every fetched document", async () => {
    mockFetchSkuSearchRows.mockResolvedValue([fakeRow("sku-1"), fakeRow("sku-2")]);
    mockImport.mockResolvedValue([{ success: true }, { success: true }]);

    const { reindexTypesense } = await import("./reindex-typesense.js");
    const result = await reindexTypesense(sql);

    expect(mockEnsureCardsCollectionExists).toHaveBeenCalledTimes(1);
    expect(mockImport).toHaveBeenCalledWith([{ id: "sku-1" }, { id: "sku-2" }], {
      action: "upsert",
    });
    expect(result).toMatchObject({
      status: "completed",
      documentsIndexed: 2,
      documentsFailed: 0,
    });
  });

  it("splits the import into batches for large result sets", async () => {
    const rows = Array.from({ length: 1500 }, (_, i) => fakeRow(`sku-${i}`));
    mockFetchSkuSearchRows.mockResolvedValue(rows);
    mockImport.mockImplementation((batch: unknown[]) =>
      Promise.resolve(batch.map(() => ({ success: true }))),
    );

    const { reindexTypesense } = await import("./reindex-typesense.js");
    const result = await reindexTypesense(sql);

    expect(mockImport).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      status: "completed",
      documentsIndexed: 1500,
      documentsFailed: 0,
    });
  });

  it("counts per-document import failures separately from success", async () => {
    mockFetchSkuSearchRows.mockResolvedValue([fakeRow("sku-1"), fakeRow("sku-2")]);
    mockImport.mockResolvedValue([{ success: true }, { success: false, error: "bad request" }]);

    const { reindexTypesense } = await import("./reindex-typesense.js");
    const result = await reindexTypesense(sql);

    expect(result).toMatchObject({ status: "completed", documentsIndexed: 1, documentsFailed: 1 });
  });

  it("returns a 'failed' result instead of throwing when the Postgres read fails", async () => {
    mockFetchSkuSearchRows.mockRejectedValue(new Error("connection refused"));

    const { reindexTypesense } = await import("./reindex-typesense.js");
    const result = await reindexTypesense(sql);

    expect(result).toMatchObject({ status: "failed", error: "connection refused" });
    expect(mockImport).not.toHaveBeenCalled();
  });
});
