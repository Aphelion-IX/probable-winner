import { describe, expect, it } from "vitest";

import {
  buildNameLookup,
  matchLinesAgainstCandidates,
  resolveLineCandidates,
  uniqueNames,
  type DecklistMatchCandidate,
} from "./match-decklist-lines";
import { parseDecklistLine } from "@/features/deck-builder/lib/parse-decklist";

const BOLT_2X2: DecklistMatchCandidate = {
  printingId: "printing-bolt-2x2",
  oracleCardId: "oracle-bolt",
  name: "Lightning Bolt",
  setCode: "2X2",
  setName: "Double Masters 2022",
  collectorNumber: "117",
};

const BOLT_M11: DecklistMatchCandidate = {
  printingId: "printing-bolt-m11",
  oracleCardId: "oracle-bolt",
  name: "Lightning Bolt",
  setCode: "M11",
  setName: "Magic 2011",
  collectorNumber: "146",
};

const COUNTERSPELL: DecklistMatchCandidate = {
  printingId: "printing-counterspell",
  oracleCardId: "oracle-counterspell",
  name: "Counterspell",
  setCode: "2X2",
  setName: "Double Masters 2022",
  collectorNumber: "94",
};

describe("uniqueNames", () => {
  it("deduplicates card names across lines", () => {
    const lines = ["4 Lightning Bolt", "2 Lightning Bolt", "1 Counterspell"].map((raw) =>
      parseDecklistLine(raw)!,
    );

    expect(uniqueNames(lines)).toEqual(["Lightning Bolt", "Counterspell"]);
  });
});

describe("buildNameLookup / resolveLineCandidates", () => {
  const lookup = buildNameLookup([BOLT_2X2, BOLT_M11, COUNTERSPELL]);

  it("returns every printing of a name when no set code is given (ambiguous)", () => {
    const line = parseDecklistLine("4 Lightning Bolt")!;
    expect(resolveLineCandidates(line, lookup)).toEqual(
      expect.arrayContaining([BOLT_2X2, BOLT_M11]),
    );
    expect(resolveLineCandidates(line, lookup)).toHaveLength(2);
  });

  it("narrows to a single exact printing when a set code is given", () => {
    const line = parseDecklistLine("4 Lightning Bolt (2X2) 117")!;
    expect(resolveLineCandidates(line, lookup)).toEqual([BOLT_2X2]);
  });

  it("matches the set code case-insensitively", () => {
    const line = parseDecklistLine("4 Lightning Bolt (m11)")!;
    expect(resolveLineCandidates(line, lookup)).toEqual([BOLT_M11]);
  });

  it("narrows further by collector number when both are given", () => {
    const line = parseDecklistLine("4 Lightning Bolt (2X2) 117")!;
    expect(resolveLineCandidates(line, lookup)).toEqual([BOLT_2X2]);
  });

  it("returns no candidates for a name that doesn't exist in the catalogue", () => {
    const line = parseDecklistLine("4 Not A Real Card")!;
    expect(resolveLineCandidates(line, lookup)).toEqual([]);
  });

  it("returns no candidates when the set code doesn't match any printing of that name", () => {
    const line = parseDecklistLine("4 Lightning Bolt (XYZ)")!;
    expect(resolveLineCandidates(line, lookup)).toEqual([]);
  });
});

describe("matchLinesAgainstCandidates", () => {
  it("resolves every line against the full candidate set in one pass", () => {
    const lines = ["4 Lightning Bolt (2X2) 117", "1 Counterspell", "2 Unknown Card"].map((raw) =>
      parseDecklistLine(raw)!,
    );

    const result = matchLinesAgainstCandidates(lines, [BOLT_2X2, BOLT_M11, COUNTERSPELL]);

    expect(result).toEqual([
      { line: lines[0], candidates: [BOLT_2X2] },
      { line: lines[1], candidates: [COUNTERSPELL] },
      { line: lines[2], candidates: [] },
    ]);
  });
});
