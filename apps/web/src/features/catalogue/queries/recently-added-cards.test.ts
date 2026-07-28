import { describe, expect, it, vi, beforeEach } from "vitest";

const mockQuerySearchService = vi.fn();

vi.mock("@/lib/search-service-client", () => ({
  querySearchService: (...args: unknown[]) => mockQuerySearchService(...args),
}));

function fakeDoc(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "sku-1",
    printing_id: "printing-1",
    oracle_id: "oracle-1",
    name: "Lightning Bolt",
    set_code: "2X2",
    rarity: "uncommon",
    condition: "nm",
    finish: "nonfoil",
    price_amount: 1.5,
    quantity_available: 4,
    ...overrides,
  };
}

function outcome(hits: unknown[]) {
  return { hits, page: 1, pageSize: hits.length, totalHits: hits.length, totalPages: 1, processingTimeMs: 1 };
}

describe("listRecentlyAddedCards", () => {
  beforeEach(() => {
    mockQuerySearchService.mockReset();
  });

  it("queries the search service sorted newest-first and filtered to in-stock items", async () => {
    mockQuerySearchService.mockResolvedValue(outcome([]));

    const { listRecentlyAddedCards } = await import("./recently-added-cards");
    await listRecentlyAddedCards(12);

    expect(mockQuerySearchService).toHaveBeenCalledWith(
      expect.objectContaining({ q: "*", sort: "newest", inStock: true, limit: 48 }),
    );
  });

  it("maps hits to the display shape, keyed by printing id", async () => {
    mockQuerySearchService.mockResolvedValue(outcome([fakeDoc()]));

    const { listRecentlyAddedCards } = await import("./recently-added-cards");
    const result = await listRecentlyAddedCards(12);

    expect(result).toEqual([
      {
        printingId: "printing-1",
        name: "Lightning Bolt",
        setCode: "2X2",
        rarity: "uncommon",
        condition: "nm",
        finish: "nonfoil",
        price: 1.5,
      },
    ]);
  });

  it("dedupes multiple SKU documents for the same oracle card", async () => {
    mockQuerySearchService.mockResolvedValue(
      outcome([
        fakeDoc({ id: "sku-1", printing_id: "printing-1" }),
        fakeDoc({ id: "sku-2", printing_id: "printing-1", condition: "lp" }),
        fakeDoc({
          id: "sku-3",
          printing_id: "printing-2",
          oracle_id: "oracle-2",
          name: "Counterspell",
        }),
      ]),
    );

    const { listRecentlyAddedCards } = await import("./recently-added-cards");
    const result = await listRecentlyAddedCards(12);

    expect(result).toHaveLength(2);
    expect(result.map((card) => card.name)).toEqual(["Lightning Bolt", "Counterspell"]);
  });

  it("stops once the requested limit is reached, even with more hits available", async () => {
    mockQuerySearchService.mockResolvedValue(
      outcome([
        fakeDoc({ oracle_id: "oracle-1", printing_id: "printing-1" }),
        fakeDoc({ oracle_id: "oracle-2", printing_id: "printing-2" }),
        fakeDoc({ oracle_id: "oracle-3", printing_id: "printing-3" }),
      ]),
    );

    const { listRecentlyAddedCards } = await import("./recently-added-cards");
    const result = await listRecentlyAddedCards(2);

    expect(result).toHaveLength(2);
  });
});
