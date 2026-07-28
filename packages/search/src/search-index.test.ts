import { describe, expect, it } from "vitest";

import type { CardSearchDocument } from "./card-search-document";
import {
  buildSearchIndex,
  createEmptySearchIndex,
  deserializeSearchIndex,
  patchDocument,
  removeDocument,
  serializeSearchIndex,
  upsertDocument,
} from "./search-index";

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
    last_updated_at: Date.now(),
    catalogued_at: Date.now(),
    ...overrides,
  };
}

describe("buildSearchIndex", () => {
  it("indexes every document for both text search and direct lookup", () => {
    const index = buildSearchIndex([doc()]);

    expect(index.docsById.get("sku-1")?.name).toBe("Lightning Bolt");
    expect(index.mini.has("sku-1")).toBe(true);
  });
});

describe("upsertDocument", () => {
  it("adds a new document to an empty index", () => {
    const index = createEmptySearchIndex();

    upsertDocument(index, doc());

    expect(index.docsById.has("sku-1")).toBe(true);
    expect(index.mini.has("sku-1")).toBe(true);
  });

  it("replaces an existing document rather than duplicating it", () => {
    const index = buildSearchIndex([doc({ price_amount: 5 })]);

    upsertDocument(index, doc({ price_amount: 8 }));

    expect(index.docsById.get("sku-1")?.price_amount).toBe(8);
    expect(index.docsById.size).toBe(1);
  });
});

describe("removeDocument", () => {
  it("removes a document from both the index and the doc map", () => {
    const index = buildSearchIndex([doc()]);

    removeDocument(index, "sku-1");

    expect(index.docsById.has("sku-1")).toBe(false);
    expect(index.mini.has("sku-1")).toBe(false);
  });

  it("is a no-op for an id that was never indexed", () => {
    const index = createEmptySearchIndex();

    expect(() => removeDocument(index, "does-not-exist")).not.toThrow();
  });
});

describe("patchDocument", () => {
  it("merges a partial update into the existing document", () => {
    const index = buildSearchIndex([doc({ popularity_score: 10 })]);

    const patched = patchDocument(index, "sku-1", { popularity_score: 42 });

    expect(patched).toBe(true);
    expect(index.docsById.get("sku-1")).toMatchObject({
      popularity_score: 42,
      name: "Lightning Bolt",
    });
  });

  it("returns false and does nothing for an id that isn't indexed", () => {
    const index = createEmptySearchIndex();

    const patched = patchDocument(index, "does-not-exist", { popularity_score: 42 });

    expect(patched).toBe(false);
    expect(index.docsById.size).toBe(0);
  });
});

describe("serializeSearchIndex / deserializeSearchIndex", () => {
  it("round-trips every document through a snapshot", () => {
    const original = buildSearchIndex([doc(), doc({ id: "sku-2", name: "Counterspell" })]);

    const restored = deserializeSearchIndex(serializeSearchIndex(original));

    expect(restored.docsById.size).toBe(2);
    expect(restored.docsById.get("sku-2")?.name).toBe("Counterspell");
    expect(restored.mini.has("sku-1")).toBe(true);
    expect(restored.mini.has("sku-2")).toBe(true);
  });
});
