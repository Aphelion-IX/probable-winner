import { describe, expect, it, vi, beforeEach } from "vitest";

const mockSearch = vi.fn();
const mockCreateTypesenseClient = vi.fn().mockReturnValue({
  collections: () => ({ documents: () => ({ search: mockSearch }) }),
});

vi.mock("@probable-winner/search", () => ({
  createTypesenseClient: (...args: unknown[]) => mockCreateTypesenseClient(...args),
  CARDS_COLLECTION_NAME: "cards",
}));

function fakeHit(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    document: {
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
    },
  };
}

describe("listRecentlyAddedCards", () => {
  beforeEach(() => {
    mockSearch.mockReset();
    mockCreateTypesenseClient.mockClear();
  });

  it("sorts by catalogued_at desc and filters to in-stock items", async () => {
    mockSearch.mockResolvedValue({ hits: [] });

    const { listRecentlyAddedCards } = await import("./recently-added-cards");
    await listRecentlyAddedCards(12);

    expect(mockSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        sort_by: "catalogued_at:desc",
        filter_by: "quantity_available:>0",
        per_page: 48,
      }),
    );
  });

  it("maps hits to the display shape, keyed by printing id", async () => {
    mockSearch.mockResolvedValue({ hits: [fakeHit()] });

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
    mockSearch.mockResolvedValue({
      hits: [
        fakeHit({ id: "sku-1", printing_id: "printing-1" }),
        fakeHit({ id: "sku-2", printing_id: "printing-1", condition: "lp" }),
        fakeHit({
          id: "sku-3",
          printing_id: "printing-2",
          oracle_id: "oracle-2",
          name: "Counterspell",
        }),
      ],
    });

    const { listRecentlyAddedCards } = await import("./recently-added-cards");
    const result = await listRecentlyAddedCards(12);

    expect(result).toHaveLength(2);
    expect(result.map((card) => card.name)).toEqual(["Lightning Bolt", "Counterspell"]);
  });

  it("stops once the requested limit is reached, even with more hits available", async () => {
    mockSearch.mockResolvedValue({
      hits: [
        fakeHit({ oracle_id: "oracle-1", printing_id: "printing-1" }),
        fakeHit({ oracle_id: "oracle-2", printing_id: "printing-2" }),
        fakeHit({ oracle_id: "oracle-3", printing_id: "printing-3" }),
      ],
    });

    const { listRecentlyAddedCards } = await import("./recently-added-cards");
    const result = await listRecentlyAddedCards(2);

    expect(result).toHaveLength(2);
  });
});
