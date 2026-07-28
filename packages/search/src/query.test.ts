import { describe, expect, it } from "vitest";

import type { CardSearchDocument } from "./card-search-document";
import { buildSearchIndex } from "./search-index";
import { runSearch } from "./query";

function doc(overrides: Partial<CardSearchDocument> = {}): CardSearchDocument {
  return {
    id: "sku-1",
    printing_id: "printing-1",
    oracle_id: "oracle-1",
    name: "Lightning Bolt",
    set_code: "LEA",
    set_name: "Limited Edition Alpha",
    collector_number: "162",
    rarity: "common",
    artist: "Christopher Rush",
    image_url: "",
    colour_identity: ["R"],
    colour_count: 1,
    mana_cost: "{R}",
    cmc: 1,
    type_line: "Instant",
    finish: "nonfoil",
    condition: "nm",
    language: "en",
    layout: "normal",
    legality: { standard: "not_legal", legacy: "legal" },
    price_amount: 5,
    price_currency: "AUD",
    quantity_available: 3,
    quantity_in_stores: { "store-1": 3 },
    popularity_score: 10,
    last_updated_at: 0,
    catalogued_at: 100,
    ...overrides,
  };
}

describe("runSearch", () => {
  it("finds a document by a prefix text match on name", () => {
    const index = buildSearchIndex([doc(), doc({ id: "sku-2", name: "Counterspell" })]);

    const result = runSearch(index, { q: "Light" });

    expect(result.hits.map((h) => h.id)).toEqual(["sku-1"]);
  });

  it("treats a bare '*' the same as no query at all", () => {
    const index = buildSearchIndex([doc(), doc({ id: "sku-2", name: "Counterspell" })]);

    const result = runSearch(index, { q: "*" });

    expect(result.totalHits).toBe(2);
  });

  it("filters by an exact field match", () => {
    const index = buildSearchIndex([
      doc({ set_code: "LEA" }),
      doc({ id: "sku-2", set_code: "M11" }),
    ]);

    const result = runSearch(index, { set: "M11" });

    expect(result.hits.map((h) => h.id)).toEqual(["sku-2"]);
  });

  it("filters colour identity by overlap, not exact match", () => {
    const index = buildSearchIndex([
      doc({ colour_identity: ["U", "B"] }),
      doc({ id: "sku-2", colour_identity: ["R"] }),
    ]);

    const result = runSearch(index, { colour: ["U"] });

    expect(result.hits.map((h) => h.id)).toEqual(["sku-1"]);
  });

  it("filters by format legality", () => {
    const index = buildSearchIndex([
      doc({ legality: { standard: "legal" } }),
      doc({ id: "sku-2", legality: { standard: "banned" } }),
    ]);

    const result = runSearch(index, { format: "standard" });

    expect(result.hits.map((h) => h.id)).toEqual(["sku-1"]);
  });

  it("filters by price range", () => {
    const index = buildSearchIndex([
      doc({ price_amount: 5 }),
      doc({ id: "sku-2", price_amount: 50 }),
    ]);

    const result = runSearch(index, { minPrice: 10, maxPrice: 100 });

    expect(result.hits.map((h) => h.id)).toEqual(["sku-2"]);
  });

  it("filters to in-stock documents only", () => {
    const index = buildSearchIndex([
      doc({ quantity_available: 0 }),
      doc({ id: "sku-2", quantity_available: 4 }),
    ]);

    const result = runSearch(index, { inStock: true });

    expect(result.hits.map((h) => h.id)).toEqual(["sku-2"]);
  });

  it("filters by per-store availability", () => {
    const index = buildSearchIndex([
      doc({ quantity_in_stores: { "store-1": 2 } }),
      doc({ id: "sku-2", quantity_in_stores: { "store-1": 0, "store-2": 5 } }),
    ]);

    const result = runSearch(index, { storeId: "store-2" });

    expect(result.hits.map((h) => h.id)).toEqual(["sku-2"]);
  });

  it("sorts by price ascending when requested", () => {
    const index = buildSearchIndex([
      doc({ price_amount: 50 }),
      doc({ id: "sku-2", price_amount: 5 }),
    ]);

    const result = runSearch(index, { sort: "price_asc" });

    expect(result.hits.map((h) => h.id)).toEqual(["sku-2", "sku-1"]);
  });

  it("sorts by newest (catalogued_at) when requested", () => {
    const index = buildSearchIndex([
      doc({ catalogued_at: 100 }),
      doc({ id: "sku-2", catalogued_at: 500 }),
    ]);

    const result = runSearch(index, { sort: "newest" });

    expect(result.hits.map((h) => h.id)).toEqual(["sku-2", "sku-1"]);
  });

  it("falls back to popularity ranking with no text query and no explicit sort", () => {
    const index = buildSearchIndex([
      doc({ popularity_score: 1 }),
      doc({ id: "sku-2", popularity_score: 99 }),
    ]);

    const result = runSearch(index, {});

    expect(result.hits.map((h) => h.id)).toEqual(["sku-2", "sku-1"]);
  });

  it("paginates results", () => {
    const docs = Array.from({ length: 25 }, (_, i) =>
      doc({ id: `sku-${i}`, name: `Card ${i}`, popularity_score: i }),
    );
    const index = buildSearchIndex(docs);

    const page1 = runSearch(index, { page: 1, limit: 10 });
    const page2 = runSearch(index, { page: 2, limit: 10 });

    expect(page1.hits).toHaveLength(10);
    expect(page2.hits).toHaveLength(10);
    expect(page1.totalHits).toBe(25);
    expect(page1.totalPages).toBe(3);
    expect(page1.hits[0].id).not.toBe(page2.hits[0].id);
  });
});
