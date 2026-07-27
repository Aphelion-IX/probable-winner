import { describe, expect, it, vi, beforeEach } from "vitest";

const mockFrom = vi.fn();

vi.mock("@/server/supabase", () => ({
  createServerSupabaseClient: () => ({ from: mockFrom }),
}));

// sellable_skus is now filtered by `.in("card_printing_id", ids)` rather than
// by the nested `card_printings.sets.code`, so the chain is
// select -> in -> eq -> range -> returns.
function skusChain(returnValue: { data: unknown; error: unknown; count?: number }) {
  return {
    select: () => ({
      in: () => ({
        eq: () => ({
          range: () => ({
            returns: () => Promise.resolve(returnValue),
          }),
        }),
      }),
    }),
  };
}

// The set code is resolved to a set id, then to that set's printing ids,
// before sellable_skus is queried at all (see fetchSetPrintingIds).
function setsChain(returnValue: { data: unknown; error: unknown }) {
  return {
    select: () => ({
      eq: () => ({
        limit: () => ({
          maybeSingle: () => Promise.resolve(returnValue),
        }),
      }),
    }),
  };
}

function printingsChain(returnValue: { data: unknown; error: unknown }) {
  return {
    select: () => ({
      eq: () => ({
        range: () => ({
          returns: () => Promise.resolve(returnValue),
        }),
      }),
    }),
  };
}

// Every test needs the same set -> printing-ids resolution before it reaches
// the behaviour it is actually asserting, so it is answered centrally rather
// than restated in each mockImplementation. Returns null for other tables so
// the caller's own handling takes over.
function setResolution(table: string) {
  if (table === "sets") return setsChain({ data: { id: "set-1" }, error: null });
  if (table === "card_printings") {
    return printingsChain({ data: [{ id: "printing-1" }], error: null });
  }
  return null;
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
      border_color: "black",
      oracle_cards: { id: "oracle-1", name: "Lightning Bolt", type_line: "Instant", colors: ["R"] },
    },
    ...overrides,
  };
}

// For tests that only care about which sellable_skus rows survive
// filtering -- images/prices/balances are irrelevant to the assertion.
function noopDownstream(table: string) {
  const resolved = setResolution(table);
  if (resolved) return resolved;
  if (table === "card_images") return imagesChain({ data: [], error: null });
  if (table === "published_prices") return pricesChain({ data: [], error: null });
  if (table === "inventory_balances") return balancesChain({ data: [], error: null });
  throw new Error(`unexpected table: ${table}`);
}

describe("listSetCards", () => {
  beforeEach(() => {
    mockFrom.mockReset();
  });

  it("returns an empty array without querying prices/balances when the set has no SKUs", async () => {
    mockFrom.mockImplementation((table: string) => {
      const resolved = setResolution(table);
      if (resolved) return resolved;
      if (table === "sellable_skus") return skusChain({ data: [], error: null });
      throw new Error(`unexpected table: ${table}`);
    });
    const { listSetCards } = await import("./list-set-cards");

    const result = await listSetCards("2X2");

    expect(result).toEqual([]);
    // sets -> card_printings -> sellable_skus, then it stops: no images,
    // prices or balances are fetched for a set with no SKUs.
    expect(mockFrom).toHaveBeenCalledTimes(3);
    expect(mockFrom).not.toHaveBeenCalledWith("published_prices");
    expect(mockFrom).not.toHaveBeenCalledWith("inventory_balances");
  });

  it("stops before querying sellable_skus when the set code does not exist", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "sets") return setsChain({ data: null, error: null });
      throw new Error(`unexpected table: ${table}`);
    });
    const { listSetCards } = await import("./list-set-cards");

    await expect(listSetCards("NOPE")).resolves.toEqual([]);
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it("throws when the SKU query fails", async () => {
    mockFrom.mockImplementation((table: string) => {
      const resolved = setResolution(table);
      if (resolved) return resolved;
      if (table === "sellable_skus") return skusChain({ data: null, error: { message: "boom" } });
      throw new Error(`unexpected table: ${table}`);
    });
    const { listSetCards } = await import("./list-set-cards");

    await expect(listSetCards("2X2")).rejects.toThrow("Failed to list set cards: boom");
  });

  it("aggregates conditions into one row per printing+finish, picking the cheapest active price", async () => {
    mockFrom.mockImplementation((table: string) => {
      const resolved = setResolution(table);
      if (resolved) return resolved;
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
        borderColor: "black",
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
        borderColor: "black",
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
      const resolved = setResolution(table);
      if (resolved) return resolved;
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

  it("pages past Postgrest's 1000-row cap, batches .in() lookups, and caps the result at 200 rows", async () => {
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
      const resolved = setResolution(table);
      if (resolved) return resolved;
      if (table === "sellable_skus") {
        callCounts.sellable_skus += 1;
        if (callCounts.sellable_skus === 1) {
          return skusChain({ data: pageOne, error: null, count: 1001 });
        }
        return skusChain({ data: pageTwo, error: null });
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

    // 1001 rows in -> a second page of sellable_skus (paged at Postgrest's
    // 1000-row cap, independent of ID_BATCH_SIZE), and 1001 distinct
    // printing/sku ids -> six 200-sized .in() batches (200 x5, 1).
    expect(callCounts.sellable_skus).toBe(2);
    expect(callCounts.card_images).toBe(6);
    expect(callCounts.published_prices).toBe(6);
    // ...but the returned rows are capped well below that.
    expect(result).toHaveLength(200);
  });

  it("retries a transient network failure and still returns correct data", async () => {
    let priceAttempts = 0;
    mockFrom.mockImplementation((table: string) => {
      const resolved = setResolution(table);
      if (resolved) return resolved;
      if (table === "sellable_skus") return skusChain({ data: [fakeSkuRow()], error: null });
      if (table === "card_images") return imagesChain({ data: [], error: null });
      if (table === "published_prices") {
        priceAttempts += 1;
        if (priceAttempts === 1) {
          return {
            select: () => ({
              in: () => ({
                eq: () => Promise.reject(new TypeError("fetch failed")),
              }),
            }),
          };
        }
        return pricesChain({
          data: [{ sellable_sku_id: "sku-1", final_amount: 5, currency: "AUD" }],
          error: null,
        });
      }
      if (table === "inventory_balances") {
        return balancesChain({
          data: [{ sellable_sku_id: "sku-1", quantity_available_online: 3 }],
          error: null,
        });
      }
      throw new Error(`unexpected table: ${table}`);
    });
    const { listSetCards } = await import("./list-set-cards");

    const result = await listSetCards("2X2");

    expect(priceAttempts).toBe(2);
    expect(result[0].price).toBe(5);
  });

  it("gives up after exhausting retries on a persistent network failure", async () => {
    mockFrom.mockImplementation((table: string) => {
      const resolved = setResolution(table);
      if (resolved) return resolved;
      if (table === "sellable_skus") return skusChain({ data: [fakeSkuRow()], error: null });
      if (table === "card_images") return imagesChain({ data: [], error: null });
      if (table === "published_prices") {
        return {
          select: () => ({
            in: () => ({
              eq: () => Promise.reject(new TypeError("fetch failed")),
            }),
          }),
        };
      }
      if (table === "inventory_balances") return balancesChain({ data: [], error: null });
      throw new Error(`unexpected table: ${table}`);
    });
    const { listSetCards } = await import("./list-set-cards");

    await expect(listSetCards("2X2")).rejects.toThrow("fetch failed");
  });

  it("filters by colour, including the colourless option", async () => {
    mockFrom.mockImplementation((table: string) => {
      const resolved = setResolution(table);
      if (resolved) return resolved;
      if (table === "sellable_skus") {
        return skusChain({
          data: [
            fakeSkuRow({
              id: "sku-red",
              card_printing_id: "printing-red",
              card_printings: {
                id: "printing-red",
                rarity: "common",
                collector_number: "1",
                border_color: "black",
                oracle_cards: {
                  id: "o-red",
                  name: "Red Card",
                  type_line: "Instant",
                  colors: ["R"],
                },
              },
            }),
            fakeSkuRow({
              id: "sku-blue",
              card_printing_id: "printing-blue",
              card_printings: {
                id: "printing-blue",
                rarity: "common",
                collector_number: "2",
                border_color: "black",
                oracle_cards: {
                  id: "o-blue",
                  name: "Blue Card",
                  type_line: "Instant",
                  colors: ["U"],
                },
              },
            }),
            fakeSkuRow({
              id: "sku-colourless",
              card_printing_id: "printing-cl",
              card_printings: {
                id: "printing-cl",
                rarity: "common",
                collector_number: "3",
                border_color: "black",
                oracle_cards: {
                  id: "o-cl",
                  name: "Colourless Card",
                  type_line: "Artifact",
                  colors: [],
                },
              },
            }),
          ],
          error: null,
        });
      }
      return noopDownstream(table);
    });
    const { listSetCards } = await import("./list-set-cards");

    const result = await listSetCards("2X2", { colors: ["R", "C"] });

    expect(result.map((r) => r.name).sort()).toEqual(["Colourless Card", "Red Card"]);
  });

  it("filters by finish", async () => {
    mockFrom.mockImplementation((table: string) => {
      const resolved = setResolution(table);
      if (resolved) return resolved;
      if (table === "sellable_skus") {
        return skusChain({
          data: [
            fakeSkuRow({ id: "sku-nonfoil", finishes: { code: "nonfoil" } }),
            fakeSkuRow({
              id: "sku-foil",
              card_printing_id: "printing-2",
              finishes: { code: "foil" },
              card_printings: {
                id: "printing-2",
                rarity: "rare",
                collector_number: "2",
                border_color: "black",
                oracle_cards: {
                  id: "oracle-2",
                  name: "Foil Card",
                  type_line: "Instant",
                  colors: ["R"],
                },
              },
            }),
          ],
          error: null,
        });
      }
      return noopDownstream(table);
    });
    const { listSetCards } = await import("./list-set-cards");

    const result = await listSetCards("2X2", { finishes: ["foil"] });

    expect(result).toHaveLength(1);
    expect(result[0].finishCode).toBe("foil");
  });

  it("filters by treatment (border colour)", async () => {
    mockFrom.mockImplementation((table: string) => {
      const resolved = setResolution(table);
      if (resolved) return resolved;
      if (table === "sellable_skus") {
        return skusChain({
          data: [
            fakeSkuRow({ id: "sku-standard" }),
            fakeSkuRow({
              id: "sku-borderless",
              card_printing_id: "printing-2",
              card_printings: {
                id: "printing-2",
                rarity: "rare",
                collector_number: "2",
                border_color: "borderless",
                oracle_cards: {
                  id: "oracle-2",
                  name: "Borderless Card",
                  type_line: "Instant",
                  colors: ["R"],
                },
              },
            }),
          ],
          error: null,
        });
      }
      return noopDownstream(table);
    });
    const { listSetCards } = await import("./list-set-cards");

    const result = await listSetCards("2X2", { borderColors: ["borderless"] });

    expect(result).toHaveLength(1);
    expect(result[0].borderColor).toBe("borderless");
  });

  it("sorts by price when requested, putting rows with no active price last", async () => {
    mockFrom.mockImplementation((table: string) => {
      const resolved = setResolution(table);
      if (resolved) return resolved;
      if (table === "sellable_skus") {
        return skusChain({
          data: [
            fakeSkuRow({
              id: "sku-cheap",
              card_printing_id: "printing-cheap",
              card_printings: {
                id: "printing-cheap",
                rarity: "common",
                collector_number: "1",
                border_color: "black",
                oracle_cards: {
                  id: "o-cheap",
                  name: "Cheap Card",
                  type_line: "Instant",
                  colors: ["R"],
                },
              },
            }),
            fakeSkuRow({
              id: "sku-pricey",
              card_printing_id: "printing-pricey",
              card_printings: {
                id: "printing-pricey",
                rarity: "rare",
                collector_number: "2",
                border_color: "black",
                oracle_cards: {
                  id: "o-pricey",
                  name: "Pricey Card",
                  type_line: "Instant",
                  colors: ["U"],
                },
              },
            }),
            fakeSkuRow({
              id: "sku-unpriced",
              card_printing_id: "printing-unpriced",
              card_printings: {
                id: "printing-unpriced",
                rarity: "common",
                collector_number: "3",
                border_color: "black",
                oracle_cards: {
                  id: "o-unpriced",
                  name: "Unpriced Card",
                  type_line: "Instant",
                  colors: ["G"],
                },
              },
            }),
          ],
          error: null,
        });
      }
      if (table === "card_images") return imagesChain({ data: [], error: null });
      if (table === "published_prices") {
        return pricesChain({
          data: [
            { sellable_sku_id: "sku-cheap", final_amount: 1, currency: "AUD" },
            { sellable_sku_id: "sku-pricey", final_amount: 100, currency: "AUD" },
          ],
          error: null,
        });
      }
      if (table === "inventory_balances") return balancesChain({ data: [], error: null });
      throw new Error(`unexpected table: ${table}`);
    });
    const { listSetCards } = await import("./list-set-cards");

    const desc = await listSetCards("2X2", { sort: "price-desc" });
    expect(desc.map((r) => r.name)).toEqual(["Pricey Card", "Cheap Card", "Unpriced Card"]);

    const asc = await listSetCards("2X2", { sort: "price-asc" });
    expect(asc.map((r) => r.name)).toEqual(["Cheap Card", "Pricey Card", "Unpriced Card"]);
  });
});
