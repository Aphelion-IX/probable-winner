import { describe, expect, it, vi, beforeEach } from "vitest";

const mockRpc = vi.fn();

vi.mock("@/server/supabase", () => ({
  createServerSupabaseClient: () => ({ rpc: mockRpc }),
}));

function fakeRpcRow(overrides: Record<string, unknown> = {}) {
  return {
    printing_id: "printing-1",
    name: "Lightning Bolt",
    type_line: "Instant",
    colors: ["R"],
    rarity: "rare",
    collector_number: "1",
    finish_code: "nonfoil",
    border_color: "black",
    representative_sku_id: "sku-1",
    price: 5,
    currency: "AUD",
    available_quantity: 4,
    image_url: "https://cards.scryfall.io/x.jpg",
    ...overrides,
  };
}

// Grouping, filtering, sorting, and the 200-row cap all now live in the
// list_set_cards() database function (see
// supabase/migrations/20260728230342_list_set_cards_function.sql) -- these
// tests only need to check that listSetCards() calls it with the right
// params and maps its snake_case rows back to SetCardRow correctly, not
// re-verify grouping/sort/filter semantics client-side.
describe("listSetCards", () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it("returns an empty array when the RPC has no rows", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    const { listSetCards } = await import("./list-set-cards");

    const result = await listSetCards("2X2");

    expect(result).toEqual([]);
  });

  it("throws when the RPC errors", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { listSetCards } = await import("./list-set-cards");

    await expect(listSetCards("2X2")).rejects.toThrow("Failed to list set cards: boom");
  });

  it("maps RPC rows to SetCardRow", async () => {
    mockRpc.mockResolvedValue({ data: [fakeRpcRow()], error: null });
    const { listSetCards } = await import("./list-set-cards");

    const result = await listSetCards("2X2");

    expect(result).toEqual([
      {
        printingId: "printing-1",
        name: "Lightning Bolt",
        typeLine: "Instant",
        colors: ["R"],
        rarity: "rare",
        collectorNumber: "1",
        finishCode: "nonfoil",
        borderColor: "black",
        representativeSkuId: "sku-1",
        price: 5,
        currency: "AUD",
        availableQuantity: 4,
        imageUrl: "https://cards.scryfall.io/x.jpg",
      },
    ]);
  });

  it("maps a null price/currency/image through unchanged", async () => {
    mockRpc.mockResolvedValue({
      data: [fakeRpcRow({ price: null, currency: null, image_url: null })],
      error: null,
    });
    const { listSetCards } = await import("./list-set-cards");

    const result = await listSetCards("2X2");

    expect(result[0].price).toBeNull();
    expect(result[0].currency).toBeNull();
    expect(result[0].imageUrl).toBeNull();
  });

  it("passes defaults for an empty options object", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    const { listSetCards } = await import("./list-set-cards");

    await listSetCards("2X2");

    expect(mockRpc).toHaveBeenCalledWith("list_set_cards", {
      p_set_code: "2X2",
      p_in_stock_only: false,
      p_colors: [],
      p_finishes: [],
      p_border_colors: [],
      p_sort: "name-asc",
      p_limit: 200,
    });
  });

  it("passes through inStockOnly and sort", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    const { listSetCards } = await import("./list-set-cards");

    await listSetCards("2X2", { inStockOnly: true, sort: "price-desc" });

    expect(mockRpc).toHaveBeenCalledWith(
      "list_set_cards",
      expect.objectContaining({ p_in_stock_only: true, p_sort: "price-desc" }),
    );
  });

  it("only forwards known colours, finishes, and border colours to the RPC", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    const { listSetCards } = await import("./list-set-cards");

    await listSetCards("2X2", {
      colors: ["R", "not-a-colour"],
      finishes: ["foil", "not-a-finish"],
      borderColors: ["borderless", "not-a-border"],
    });

    expect(mockRpc).toHaveBeenCalledWith(
      "list_set_cards",
      expect.objectContaining({
        p_colors: ["R"],
        p_finishes: ["foil"],
        p_border_colors: ["borderless"],
      }),
    );
  });
});
