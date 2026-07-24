import { describe, expect, it } from "vitest";

import { buildFilterBy, buildSortBy } from "./build-search-query";

describe("buildFilterBy", () => {
  it("returns undefined when no filters are set", () => {
    expect(buildFilterBy({})).toBeUndefined();
  });

  it("builds an exact-match filter for each simple field", () => {
    expect(buildFilterBy({ set: "2X2" })).toBe("set_code:=`2X2`");
    expect(buildFilterBy({ collectorNumber: "117" })).toBe("collector_number:=`117`");
    expect(buildFilterBy({ rarity: "mythic" })).toBe("rarity:=`mythic`");
    expect(buildFilterBy({ finish: "foil" })).toBe("finish:=`foil`");
    expect(buildFilterBy({ condition: "nm" })).toBe("condition:=`nm`");
  });

  it("quotes artist names containing spaces", () => {
    expect(buildFilterBy({ artist: "Jesper Ejsing" })).toBe("artist:=`Jesper Ejsing`");
  });

  it("strips backticks from user input so a value can't escape its own quoting", () => {
    expect(buildFilterBy({ artist: "a`) || (1:=1" })).toBe("artist:=`a) || (1:=1`");
  });

  it("builds a colour-identity containment filter for multiple colours", () => {
    expect(buildFilterBy({ colour: ["W", "U"] })).toBe("colour_identity:=[W,U]");
  });

  it("builds a nested legality filter for format", () => {
    expect(buildFilterBy({ format: "standard" })).toBe("legality.standard:=legal");
  });

  it("builds price-range filters from minPrice/maxPrice", () => {
    expect(buildFilterBy({ minPrice: 5, maxPrice: 20 })).toBe(
      "price_amount:>=5 && price_amount:<=20",
    );
  });

  it("builds an in-stock filter", () => {
    expect(buildFilterBy({ inStock: true })).toBe("quantity_available:>0");
  });

  it("builds a nested per-store availability filter", () => {
    expect(buildFilterBy({ storeId: "store-1" })).toBe("quantity_in_stores.store-1:>0");
  });

  it("combines multiple filters with &&", () => {
    expect(buildFilterBy({ set: "2X2", condition: "nm", inStock: true })).toBe(
      "set_code:=`2X2` && condition:=`nm` && quantity_available:>0",
    );
  });
});

describe("buildSortBy", () => {
  it("maps price_asc/price_desc/popularity to the corresponding Typesense sort expression", () => {
    expect(buildSortBy("price_asc")).toBe("price_amount:asc");
    expect(buildSortBy("price_desc")).toBe("price_amount:desc");
    expect(buildSortBy("popularity")).toBe("popularity_score:desc");
  });

  it("returns undefined for relevance (Typesense's own default ranking applies)", () => {
    expect(buildSortBy("relevance")).toBeUndefined();
    expect(buildSortBy(undefined)).toBeUndefined();
  });
});
