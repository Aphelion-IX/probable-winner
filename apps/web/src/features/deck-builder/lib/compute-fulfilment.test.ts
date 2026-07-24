import { describe, expect, it } from "vitest";

import { computeFulfilmentPercentage } from "./compute-fulfilment";

describe("computeFulfilmentPercentage", () => {
  it("weights by quantity, not line count", () => {
    // 4-of card unavailable, two 1-ofs preferred: 2 of 6 cards fulfillable.
    const lines = [{ quantity: 4 }, { quantity: 1 }, { quantity: 1 }];
    const outcomes = {
      0: { status: "unavailable" as const },
      1: { status: "preferred" as const },
      2: { status: "preferred" as const },
    };

    expect(computeFulfilmentPercentage(lines, outcomes)).toBe(Math.round((2 / 6) * 100));
  });

  it("counts both 'preferred' and 'substituted' outcomes as fulfillable", () => {
    const lines = [{ quantity: 2 }, { quantity: 3 }];
    const outcomes = {
      0: { status: "preferred" as const },
      1: { status: "substituted" as const },
    };

    expect(computeFulfilmentPercentage(lines, outcomes)).toBe(100);
  });

  it("treats a line with no checked outcome yet as not fulfillable", () => {
    const lines = [{ quantity: 1 }, { quantity: 1 }];
    const outcomes = { 0: { status: "preferred" as const } };

    expect(computeFulfilmentPercentage(lines, outcomes)).toBe(50);
  });

  it("returns 0 for an empty list rather than dividing by zero", () => {
    expect(computeFulfilmentPercentage([], {})).toBe(0);
  });

  it("returns 100 when every line is fulfillable", () => {
    const lines = [{ quantity: 4 }, { quantity: 2 }];
    const outcomes = {
      0: { status: "preferred" as const },
      1: { status: "substituted" as const },
    };

    expect(computeFulfilmentPercentage(lines, outcomes)).toBe(100);
  });

  it("returns 0 when nothing is fulfillable", () => {
    const lines = [{ quantity: 4 }, { quantity: 2 }];
    const outcomes = {
      0: { status: "unavailable" as const },
      1: { status: "unavailable" as const },
    };

    expect(computeFulfilmentPercentage(lines, outcomes)).toBe(0);
  });
});
