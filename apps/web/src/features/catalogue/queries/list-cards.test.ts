import { describe, expect, it } from "vitest";

import {
  buildColorFilter,
  buildTypeFilter,
  CARD_COLORS,
  CARD_TYPES,
  onlyKnown,
} from "./list-cards";

describe("onlyKnown", () => {
  it("keeps only values from the known list", () => {
    expect(onlyKnown(["W", "nope", "U"], CARD_COLORS)).toEqual(["W", "U"]);
  });

  it("returns an empty array for undefined input", () => {
    expect(onlyKnown(undefined, CARD_COLORS)).toEqual([]);
  });

  it("rejects garbage values entirely rather than passing them through", () => {
    expect(onlyKnown(["'; drop table sets; --"], CARD_COLORS)).toEqual([]);
  });
});

describe("buildColorFilter", () => {
  it("builds an overlap filter for chromatic colours", () => {
    expect(buildColorFilter(["U", "W"])).toBe("colors.ov.{U,W}");
  });

  it("builds an exact-empty-array filter for colourless", () => {
    expect(buildColorFilter(["C"])).toBe("colors.eq.{}");
  });

  it("combines chromatic overlap and colourless into one OR expression", () => {
    expect(buildColorFilter(["U", "C"])).toBe("colors.ov.{U},colors.eq.{}");
  });

  it("returns null when no colours are selected", () => {
    expect(buildColorFilter([])).toBeNull();
  });
});

describe("buildTypeFilter", () => {
  it("builds an ilike-per-type OR expression", () => {
    expect(buildTypeFilter(["Artifact"])).toBe("type_line.ilike.%Artifact%");
  });

  it("combines multiple types with OR", () => {
    expect(buildTypeFilter(["Artifact", "Creature"])).toBe(
      "type_line.ilike.%Artifact%,type_line.ilike.%Creature%",
    );
  });

  it("returns null when no types are selected", () => {
    expect(buildTypeFilter([])).toBeNull();
  });

  it("only ever contains known type names (validated upstream by onlyKnown)", () => {
    for (const type of CARD_TYPES) {
      expect(buildTypeFilter([type])).toBe(`type_line.ilike.%${type}%`);
    }
  });
});
