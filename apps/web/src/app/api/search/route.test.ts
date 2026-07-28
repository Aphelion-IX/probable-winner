import { NextRequest } from "next/server";
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockQueryLocalSearchIndex = vi.fn();

vi.mock("@/lib/search-index-cache", () => ({
  queryLocalSearchIndex: (...args: unknown[]) => mockQueryLocalSearchIndex(...args),
}));

function request(query: string) {
  return new NextRequest(`http://localhost:3000/api/search${query}`);
}

function outcome(hits: unknown[], overrides: Partial<Record<string, unknown>> = {}) {
  return {
    hits,
    page: 1,
    pageSize: 20,
    totalHits: hits.length,
    totalPages: 1,
    processingTimeMs: 3,
    ...overrides,
  };
}

describe("GET /api/search", () => {
  beforeEach(() => {
    mockQueryLocalSearchIndex.mockReset();
  });

  it("queries the search service with the parsed params and maps hits to the response shape", async () => {
    mockQueryLocalSearchIndex.mockResolvedValue(
      outcome([
        {
          id: "sku-1",
          printing_id: "printing-1",
          name: "Lightning Bolt",
          set_code: "2X2",
          rarity: "uncommon",
          artist: "Christopher Rush",
          condition: "nm",
          finish: "nonfoil",
          price_amount: 1.5,
          image_url: "https://cards.scryfall.io/normal/front/example.jpg",
        },
      ]),
    );

    const { GET } = await import("./route");
    const response = await GET(request("?q=Lightning+Bolt&condition=nm"));
    const body = await response.json();

    expect(mockQueryLocalSearchIndex).toHaveBeenCalledWith(
      expect.objectContaining({ q: "Lightning Bolt", condition: "nm", page: 1, limit: 20 }),
    );
    expect(body).toEqual({
      hits: [
        {
          id: "sku-1",
          printingId: "printing-1",
          name: "Lightning Bolt",
          set: "2X2",
          rarity: "uncommon",
          artist: "Christopher Rush",
          condition: "nm",
          finish: "nonfoil",
          price: 1.5,
          imageUrl: "https://cards.scryfall.io/normal/front/example.jpg",
        },
      ],
      page: 1,
      pageSize: 20,
      totalHits: 1,
      totalPages: 1,
      processingTimeMs: 3,
    });
  });

  it("passes an empty query through as undefined, not a literal empty string", async () => {
    mockQueryLocalSearchIndex.mockResolvedValue(outcome([]));

    const { GET } = await import("./route");
    await GET(request(""));

    expect(mockQueryLocalSearchIndex).toHaveBeenCalledWith(expect.objectContaining({ q: undefined }));
  });

  it("computes totalPages from the search service's own totalHits/pageSize", async () => {
    mockQueryLocalSearchIndex.mockResolvedValue(outcome([], { totalHits: 45, totalPages: 3 }));

    const { GET } = await import("./route");
    const response = await GET(request("?limit=20"));
    const body = await response.json();

    expect(body.totalPages).toBe(3);
  });

  it("returns a 500 with a clear message when the search service fails", async () => {
    mockQueryLocalSearchIndex.mockRejectedValue(new Error("connection refused"));

    const { GET } = await import("./route");
    const response = await GET(request(""));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "connection refused" });
  });

  it("caps the limit param at 100", async () => {
    mockQueryLocalSearchIndex.mockResolvedValue(outcome([]));

    const { GET } = await import("./route");
    await GET(request("?limit=500"));

    expect(mockQueryLocalSearchIndex).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
  });
});
