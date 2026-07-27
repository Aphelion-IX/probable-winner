import { describe, expect, it } from "vitest";

import { buildCardSearchDocument, type SkuSearchInput } from "./build-document";

const BASE_INPUT: SkuSearchInput = {
  skuId: "sku-1",
  printingId: "printing-1",
  oracleCardId: "oracle-1",
  name: "Lightning Bolt",
  typeLine: "Instant",
  manaCost: "{R}",
  cmc: 1,
  colorIdentity: ["R"],
  setCode: "dsc",
  setName: "Demo Showcase",
  collectorNumber: "3",
  rarity: "common",
  artistName: "Christopher Rush",
  imageUrl: "https://cards.scryfall.io/normal/front/example.jpg",
  finishCode: "nonfoil",
  conditionCode: "nm",
  languageCode: "en",
  legality: {},
  priceAmount: 3.5,
  priceCurrency: "AUD",
  quantityAvailable: 12,
  quantityInStores: { "node-1": 12 },
  cataloguedAt: 1700000000000,
};

describe("buildCardSearchDocument", () => {
  it("carries printing_id and image_url through into the indexed document", () => {
    const doc = buildCardSearchDocument(BASE_INPUT);

    // The card identity page routes by printing id, not the sku id --
    // search-cards.ts must have a real printing_id to build a working link
    // to the card page (confirmed live: without this, clicking a search
    // result 404s, since /cards/[name]/[id] looks up card_printings by id,
    // and a sku id never matches a row there).
    expect(doc.id).toBe("sku-1");
    expect(doc.printing_id).toBe("printing-1");
    expect(doc.image_url).toBe("https://cards.scryfall.io/normal/front/example.jpg");
  });

  it("defaults image_url to an empty string when the printing has no catalogued image", () => {
    const doc = buildCardSearchDocument({ ...BASE_INPUT, imageUrl: null });

    expect(doc.image_url).toBe("");
  });

  it("defaults artist and mana cost the same way for nulls, unchanged by this fix", () => {
    const doc = buildCardSearchDocument({ ...BASE_INPUT, artistName: null, manaCost: null });

    expect(doc.artist).toBe("");
    expect(doc.mana_cost).toBe("");
  });
});
