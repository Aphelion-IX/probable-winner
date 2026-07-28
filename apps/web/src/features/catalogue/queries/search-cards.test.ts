import { describe, expect, it, vi, beforeEach } from "vitest";

const mockQueryLocalSearchIndex = vi.fn();

vi.mock("@/lib/search-index-cache", () => ({
  queryLocalSearchIndex: (...args: unknown[]) => mockQueryLocalSearchIndex(...args),
}));

const DOCUMENT = {
  id: "sku-1",
  printing_id: "printing-1",
  name: "Lightning Bolt",
  set_code: "dsc",
  rarity: "common",
  artist: "Christopher Rush",
  condition: "nm",
  finish: "nonfoil",
  price_amount: 3.5,
  image_url: "https://cards.scryfall.io/normal/front/example.jpg",
};

function outcome(hits: unknown[]) {
  return {
    hits,
    page: 1,
    pageSize: 20,
    totalHits: hits.length,
    totalPages: 1,
    processingTimeMs: 1,
  };
}

describe("searchCards", () => {
  beforeEach(() => {
    mockQueryLocalSearchIndex.mockReset();
  });

  it("maps printing_id (not the sku id) into the hit used to link to the card page", async () => {
    mockQueryLocalSearchIndex.mockResolvedValue(outcome([DOCUMENT]));
    const { searchCards } = await import("./search-cards");

    const result = await searchCards({});

    // A regression here is what makes clicking a search result 404: the
    // card identity page routes by card_printings id, and a sku id never
    // matches a row there.
    expect(result.hits[0].id).toBe("sku-1");
    expect(result.hits[0].printingId).toBe("printing-1");
  });

  it("maps image_url into imageUrl", async () => {
    mockQueryLocalSearchIndex.mockResolvedValue(outcome([DOCUMENT]));
    const { searchCards } = await import("./search-cards");

    const result = await searchCards({});

    expect(result.hits[0].imageUrl).toBe("https://cards.scryfall.io/normal/front/example.jpg");
  });

  it("maps an empty image_url (no catalogued image) to null, not an empty string", async () => {
    mockQueryLocalSearchIndex.mockResolvedValue(outcome([{ ...DOCUMENT, image_url: "" }]));
    const { searchCards } = await import("./search-cards");

    const result = await searchCards({});

    expect(result.hits[0].imageUrl).toBeNull();
  });

  it("passes params straight through to the search service and shapes its response", async () => {
    mockQueryLocalSearchIndex.mockResolvedValue({
      hits: [],
      page: 2,
      pageSize: 48,
      totalHits: 100,
      totalPages: 3,
      processingTimeMs: 5,
    });
    const { searchCards } = await import("./search-cards");

    const result = await searchCards({ q: "bolt", page: 2, limit: 48 });

    expect(mockQueryLocalSearchIndex).toHaveBeenCalledWith({ q: "bolt", page: 2, limit: 48 });
    expect(result).toMatchObject({ page: 2, pageSize: 48, totalHits: 100, totalPages: 3 });
  });
});
