import { describe, expect, it } from "vitest";

import { selectSetsToEnqueue } from "./discover-catalogue-sets.js";
import type { MtgJsonSetListEntry } from "../integrations/mtgjson/types.js";

function set(code: string): MtgJsonSetListEntry {
  return { code, name: code, releaseDate: "2020-01-01", type: "expansion" };
}

describe("selectSetsToEnqueue", () => {
  it("returns every set code when none have been imported yet", () => {
    const codes = selectSetsToEnqueue([set("ARN"), set("MID")], new Set());

    expect(codes).toEqual(["ARN", "MID"]);
  });

  it("excludes set codes already recorded as a succeeded import run", () => {
    const codes = selectSetsToEnqueue([set("ARN"), set("MID"), set("NEO")], new Set(["MID"]));

    expect(codes).toEqual(["ARN", "NEO"]);
  });

  it("compares case-insensitively, upper-casing the set's own code", () => {
    const codes = selectSetsToEnqueue([set("arn")], new Set(["ARN"]));

    expect(codes).toEqual([]);
  });
});
