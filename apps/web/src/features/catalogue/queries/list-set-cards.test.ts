import { describe, expect, it, vi, beforeEach } from "vitest";

const mockFrom = vi.fn();

vi.mock("@/server/supabase", () => ({
  createServerSupabaseClient: () => ({ from: mockFrom }),
}));

function skusChain(returnValue: { data: unknown; error: unknown }) {
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          range: () => ({
            returns: () => Promise.resolve(returnValue),
          }),
        }),
      }),
    }),
  };
}

function imagesChain(returnValue: { data: unknown; error: unknown }) {
  return {
    select: () => ({
      in: () => ({
        eq: () => ({
          eq: () => Promise.resolve(returnValue),
        }),
      }),
    }),
  };
}

function pricesChain(returnValue: { data: unknown; error: unknown }) {
  return {
    select: () => ({
      in: () => ({
        eq: () => Promise.resolve(returnValue),
      }),
    }),
  };
}

function balancesChain(returnValue: { data: unknown; error: unknown }) {
  return {
    select: () => ({
      in: () => Promise.resolve(returnValue),
    }),
  };
}

function fakeSkuRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "sku-1",
    card_printing_id: "printing-1",
    finishes: { code: "nonfoil" },
    card_printings: {
      id: "printing-1",
      rarity: "rare",
      collector_number: "1",
      oracle_cards: { id: "oracle-1", name: "Lightning Bolt", type_line: "Instant", colors: ["R"] },
    },
    ...overrides,
  };
}

describe("listSetCards", () => {
  beforeEach(() => {
    mockFrom.mockReset();
  });

  it("returns an empty array without querying prices/balances when the set has no SKUs", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "sellable_skus") return skusChain({ data: [], error: null });
      throw new Error(`unexpected table: ${table}`);
    });
    const { listSetCards } = await import("./list-set-cards");

    const result = await listSetCards("2X2");

    expect(result).toEqual([]);
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it("throws when the SKU query fails", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "sellable_skus") return skusChain({ data: null, error: { message: "boom" } });
      throw new Error(`unexpected table: ${table}`);
    });
    const { listSetCards } = await import("./list-set-cards");

    await expect(listSetCards("2X2")).rejects.toThrow("Failed to list set cards: boom");
  });

  it("aggregates conditions into one row per printing+finish, picking the cheapest active price", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "sellable_skus") {
        return skusChain({
          data: [
            fakeSkuRow({ id: "sku-nm" }),
            fakeSkuRow({ id: "sku-lp" }),
            fakeSkuRow({
              id: "sku-foil",
              finishes: { code: "foil" },
            }),
          ],
          error: null,
        });
      }
      if (table === "card_images") {
        return imagesChain({
          data: [{ card_printing_id: "printing-1", url: "https://cards.scryfall.io/x.jpg" }],
          error: null,
        });
      }
      if (table === "published_prices") {
        return pricesChain({
          data: [
            { sellable_sku_id: "sku-nm", final_amount: 5, currency: "AUD" },
            { sellable_sku_id: "sku-lp", final_amount: 3, currency: "AUD" },
            { sellable_sku_id: "sku-foil", final_amount: 20, currency: "AUD" },
          ],
          error: null,
        });
      }
      if (table === "inventory_balances") {
        return balancesChain({
          data: [
            { sellable_sku_id: "sku-nm", quantity_available_online: 4 },
            { sellable_sku_id: "sku-lp", quantity_available_online: 2 },
            { sellable_sku_id: "sku-foil", quantity_available_online: 1 },
          ],
          error: null,
        });
      }
      throw new Error(`unexpected table: ${table}`);
    });
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
        finishCode: "foil",
        representativeSkuId: "sku-foil",
        price: 20,
        currency: "AUD",
        availableQuantity: 1,
        imageUrl: "https://cards.scryfall.io/x.jpg",
      },
      {
        printingId: "printing-1",
        name: "Lightning Bolt",
        typeLine: "Instant",
        colors: ["R"],
        rarity: "rare",
        collectorNumber: "1",
        finishCode: "nonfoil",
        representativeSkuId: "sku-lp",
        price: 3,
        currency: "AUD",
        availableQuantity: 6,
        imageUrl: "https://cards.scryfall.io/x.jpg",
      },
    ]);
  });

  it("filters out zero-stock rows when inStockOnly is set", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "sellable_skus") {
        return skusChain({ data: [fakeSkuRow()], error: null });
      }
      if (table === "card_images") return imagesChain({ data: [], error: null });
      if (table === "published_prices") {
        return pricesChain({
          data: [{ sellable_sku_id: "sku-1", final_amount: 5, currency: "AUD" }],
          error: null,
        });
      }
      if (table === "inventory_balances") {
        return balancesChain({
          data: [{ sellable_sku_id: "sku-1", quantity_available_online: 0 }],
          error: null,
        });
      }
      throw new Error(`unexpected table: ${table}`);
    });
    const { listSetCards } = await import("./list-set-cards");

    const result = await listSetCards("2X2", { inStockOnly: true });

    expect(result).toEqual([]);
  });

  it("pages past Postgrest's 1000-row cap and batches the follow-up .in() lookups", async () => {
    function rowAt(index: number) {
      return fakeSkuRow({
        id: `sku-${index}`,
        card_printing_id: `printing-${index}`,
        card_printings: {
          id: `printing-${index}`,
          rarity: "common",
          collector_number: String(index),
          oracle_cards: {
            id: `oracle-${index}`,
            name: `Card ${index}`,
            type_line: "Creature",
            colors: [],
          },
        },
      });
    }
    const pageOne = Array.from({ length: 1000 }, (_, i) => rowAt(i));
    const pageTwo = [rowAt(1000)];

    const callCounts = { sellable_skus: 0, card_images: 0, published_prices: 0 };
    mockFrom.mockImplementation((table: string) => {
      if (table === "sellable_skus") {
        callCounts.sellable_skus += 1;
        const data = callCounts.sellable_skus === 1 ? pageOne : pageTwo;
        return skusChain({ data, error: null });
      }
      if (table === "card_images") {
        callCounts.card_images += 1;
        return imagesChain({ data: [], error: null });
      }
      if (table === "published_prices") {
        callCounts.published_prices += 1;
        return pricesChain({ data: [], error: null });
      }
      if (table === "inventory_balances") return balancesChain({ data: [], error: null });
      throw new Error(`unexpected table: ${table}`);
    });
    const { listSetCards } = await import("./list-set-cards");

    const result = await listSetCards("2X2");

    // 1001 rows in -> a second page of sellable_skus, and 1001 distinct
    // printing/sku ids -> three 500-sized .in() batches (500, 500, 1).
    expect(callCounts.sellable_skus).toBe(2);
    expect(callCounts.card_images).toBe(3);
    expect(callCounts.published_prices).toBe(3);
    expect(result).toHaveLength(1001);
  });
});
