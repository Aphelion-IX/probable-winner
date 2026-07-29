import { describe, expect, it, vi, beforeEach } from "vitest";

const mockRpc = vi.fn();
const mockCreatePublicSupabaseClient = vi.fn();
const mockCreateServerSupabaseClient = vi.fn();

vi.mock("@/server/supabase", () => ({
  createPublicSupabaseClient: (...args: unknown[]) => mockCreatePublicSupabaseClient(...args),
  createServerSupabaseClient: (...args: unknown[]) => mockCreateServerSupabaseClient(...args),
}));

vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
}));

function fakeRpcRow(overrides: Record<string, unknown> = {}) {
  return {
    printing_id: "printing-1",
    oracle_card_id: "oracle-1",
    name: "Lightning Bolt",
    type_line: "Instant",
    colors: ["R"],
    color_identity: ["R"],
    collector_number: "1",
    rarity: "common",
    finishes: ["nonfoil"],
    released_at: "1993-08-05",
    set_code: "LEA",
    set_name: "Limited Edition Alpha",
    set_icon_url: "https://example.com/lea.svg",
    image_url: "https://cards.scryfall.io/x.jpg",
    price: 5,
    ...overrides,
  };
}

describe("listPopularCards", () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockCreatePublicSupabaseClient.mockReset();
    mockCreateServerSupabaseClient.mockReset();
    mockCreatePublicSupabaseClient.mockReturnValue({ rpc: mockRpc });
  });

  it("uses the cookie-free public client, not the session-aware one", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    const { listPopularCards } = await import("./list-popular-cards");

    await listPopularCards();

    expect(mockCreatePublicSupabaseClient).toHaveBeenCalled();
    expect(mockCreateServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("passes the requested limit through to the RPC", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    const { listPopularCards } = await import("./list-popular-cards");

    await listPopularCards(12);

    expect(mockRpc).toHaveBeenCalledWith("list_popular_cards", { p_limit: 12 });
  });

  it("returns an empty array when the RPC has no rows", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    const { listPopularCards } = await import("./list-popular-cards");

    expect(await listPopularCards()).toEqual([]);
  });

  it("throws when the RPC errors", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { listPopularCards } = await import("./list-popular-cards");

    await expect(listPopularCards()).rejects.toThrow("Failed to list popular cards: boom");
  });

  it("maps RPC rows to PopularCardItem", async () => {
    mockRpc.mockResolvedValue({ data: [fakeRpcRow()], error: null });
    const { listPopularCards } = await import("./list-popular-cards");

    const result = await listPopularCards();

    expect(result).toEqual([
      {
        printingId: "printing-1",
        oracleCardId: "oracle-1",
        name: "Lightning Bolt",
        typeLine: "Instant",
        colors: ["R"],
        colorIdentity: ["R"],
        collectorNumber: "1",
        rarity: "common",
        finishes: ["nonfoil"],
        releasedAt: "1993-08-05",
        setCode: "LEA",
        setName: "Limited Edition Alpha",
        setIconUrl: "https://example.com/lea.svg",
        imageUrl: "https://cards.scryfall.io/x.jpg",
        price: 5,
      },
    ]);
  });

  it("maps a null price through unchanged", async () => {
    mockRpc.mockResolvedValue({ data: [fakeRpcRow({ price: null })], error: null });
    const { listPopularCards } = await import("./list-popular-cards");

    const result = await listPopularCards();

    expect(result[0].price).toBeNull();
  });
});
