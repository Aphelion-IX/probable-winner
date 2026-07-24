import { NextRequest } from "next/server";
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockSearch = vi.fn();
const mockCreateTypesenseClient = vi.fn().mockReturnValue({
  collections: () => ({ documents: () => ({ search: mockSearch }) }),
});

vi.mock("@probable-winner/search", () => ({
  createTypesenseClient: (...args: unknown[]) => mockCreateTypesenseClient(...args),
  CARDS_COLLECTION_NAME: "cards",
}));

function request(query: string) {
  return new NextRequest(`http://localhost:3000/api/search${query}`);
}

describe("GET /api/search", () => {
  beforeEach(() => {
    mockSearch.mockReset();
  });

  it("queries Typesense with the parsed params and maps hits to the response shape", async () => {
    mockSearch.mockResolvedValue({
      found: 1,
      search_time_ms: 3,
      hits: [
        {
          document: {
            id: "sku-1",
            name: "Lightning Bolt",
            set_code: "2X2",
            rarity: "uncommon",
            artist: "Christopher Rush",
            condition: "nm",
            finish: "nonfoil",
            price_amount: 1.5,
          },
        },
      ],
    });

    const { GET } = await import("./route");
    const response = await GET(request("?q=Lightning+Bolt&condition=nm"));
    const body = await response.json();

    expect(mockSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        q: "Lightning Bolt",
        query_by: "name",
        filter_by: "condition:=`nm`",
        page: 1,
        per_page: 20,
      }),
    );
    expect(body).toEqual({
      hits: [
        {
          id: "sku-1",
          name: "Lightning Bolt",
          set: "2X2",
          rarity: "uncommon",
          artist: "Christopher Rush",
          condition: "nm",
          finish: "nonfoil",
          price: 1.5,
        },
      ],
      page: 1,
      pageSize: 20,
      totalHits: 1,
      totalPages: 1,
      processingTimeMs: 3,
    });
  });

  it("defaults an empty query to Typesense's match-all wildcard", async () => {
    mockSearch.mockResolvedValue({ found: 0, search_time_ms: 1, hits: [] });

    const { GET } = await import("./route");
    await GET(request(""));

    expect(mockSearch).toHaveBeenCalledWith(expect.objectContaining({ q: "*" }));
  });

  it("omits filter_by/sort_by entirely when no filters or explicit sort are given", async () => {
    mockSearch.mockResolvedValue({ found: 0, search_time_ms: 1, hits: [] });

    const { GET } = await import("./route");
    await GET(request(""));

    const callArgs = mockSearch.mock.calls[0][0];
    expect(callArgs).not.toHaveProperty("filter_by");
    expect(callArgs).not.toHaveProperty("sort_by");
  });

  it("computes totalPages from found/perPage", async () => {
    mockSearch.mockResolvedValue({ found: 45, search_time_ms: 2, hits: [] });

    const { GET } = await import("./route");
    const response = await GET(request("?limit=20"));
    const body = await response.json();

    expect(body.totalPages).toBe(3);
  });

  it("returns a 500 with a clear message when Typesense fails", async () => {
    mockSearch.mockRejectedValue(new Error("connection refused"));

    const { GET } = await import("./route");
    const response = await GET(request(""));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "connection refused" });
  });

  it("caps the limit param at 100", async () => {
    mockSearch.mockResolvedValue({ found: 0, search_time_ms: 1, hits: [] });

    const { GET } = await import("./route");
    await GET(request("?limit=500"));

    expect(mockSearch).toHaveBeenCalledWith(expect.objectContaining({ per_page: 100 }));
  });
});
