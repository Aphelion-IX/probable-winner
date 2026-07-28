import { describe, expect, it } from "vitest";

import { CARD_COLORS, onlyKnown } from "./list-cards";

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
