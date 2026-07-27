import { describe, expect, it, vi, beforeEach } from "vitest";

const mockSearch = vi.fn();
const mockCreateTypesenseClient = vi.fn().mockReturnValue({
  collections: () => ({ documents: () => ({ search: mockSearch }) }),
});

vi.mock("@probable-winner/search", () => ({
  createTypesenseClient: (...args: unknown[]) => mockCreateTypesenseClient(...args),
  CARDS_COLLECTION_NAME: "cards",
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

describe("searchCards", () => {
  beforeEach(() => {
    mockSearch.mockReset();
  });

  it("maps printing_id (not the sku id) into the hit used to link to the card page", async () => {
    mockSearch.mockResolvedValue({ found: 1, search_time_ms: 1, hits: [{ document: DOCUMENT }] });
    const { searchCards } = await import("./search-cards");

    const result = await searchCards({});

    // A regression here is what makes clicking a search result 404: the
    // card identity page routes by card_printings id, and a sku id never
    // matches a row there.
    expect(result.hits[0].id).toBe("sku-1");
    expect(result.hits[0].printingId).toBe("printing-1");
  });

  it("maps image_url into imageUrl", async () => {
    mockSearch.mockResolvedValue({ found: 1, search_time_ms: 1, hits: [{ document: DOCUMENT }] });
    const { searchCards } = await import("./search-cards");

    const result = await searchCards({});

    expect(result.hits[0].imageUrl).toBe("https://cards.scryfall.io/normal/front/example.jpg");
  });

  it("maps an empty image_url (no catalogued image) to null, not an empty string", async () => {
    mockSearch.mockResolvedValue({
      found: 1,
      search_time_ms: 1,
      hits: [{ document: { ...DOCUMENT, image_url: "" } }],
    });
    const { searchCards } = await import("./search-cards");

    const result = await searchCards({});

    expect(result.hits[0].imageUrl).toBeNull();
  });
});
