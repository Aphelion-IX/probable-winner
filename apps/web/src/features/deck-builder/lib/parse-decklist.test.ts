import { describe, expect, it } from "vitest";

import { parseDecklist, parseDecklistLine } from "./parse-decklist";

describe("parseDecklistLine — real-world format variants", () => {
  it("parses a plain 'quantity name' line", () => {
    expect(parseDecklistLine("4 Lightning Bolt")).toEqual({
      raw: "4 Lightning Bolt",
      quantity: 4,
      name: "Lightning Bolt",
      setCode: null,
      collectorNumber: null,
    });
  });

  it("parses a quantity with an 'x' suffix (e.g. '4x Lightning Bolt')", () => {
    expect(parseDecklistLine("4x Lightning Bolt")).toEqual(
      expect.objectContaining({ quantity: 4, name: "Lightning Bolt" }),
    );
  });

  it("parses an Arena-style export line with set code and collector number in parens", () => {
    expect(parseDecklistLine("1 Lightning Bolt (2X2) 117")).toEqual({
      raw: "1 Lightning Bolt (2X2) 117",
      quantity: 1,
      name: "Lightning Bolt",
      setCode: "2X2",
      collectorNumber: "117",
    });
  });

  it("parses a Moxfield/TappedOut-style line with a bracketed set code", () => {
    expect(parseDecklistLine("4 Lightning Bolt [2X2]")).toEqual({
      raw: "4 Lightning Bolt [2X2]",
      quantity: 4,
      name: "Lightning Bolt",
      setCode: "2X2",
      collectorNumber: null,
    });
  });

  it("parses a bare card name with no quantity, defaulting to 1", () => {
    expect(parseDecklistLine("Lightning Bolt")).toEqual({
      raw: "Lightning Bolt",
      quantity: 1,
      name: "Lightning Bolt",
      setCode: null,
      collectorNumber: null,
    });
  });

  it("parses a set code in parens with no collector number", () => {
    expect(parseDecklistLine("2 Counterspell (2X2)")).toEqual({
      raw: "2 Counterspell (2X2)",
      quantity: 2,
      name: "Counterspell",
      setCode: "2X2",
      collectorNumber: null,
    });
  });

  it("tolerates extra surrounding whitespace", () => {
    expect(parseDecklistLine("  4   Lightning Bolt  ")).toEqual(
      expect.objectContaining({ quantity: 4, name: "Lightning Bolt" }),
    );
  });

  it("returns null for a blank line", () => {
    expect(parseDecklistLine("   ")).toBeNull();
  });

  it("returns null for a comment line", () => {
    expect(parseDecklistLine("// Creatures")).toBeNull();
    expect(parseDecklistLine("# Comment")).toBeNull();
  });

  it("returns null for a section header, with or without a trailing colon", () => {
    expect(parseDecklistLine("Sideboard")).toBeNull();
    expect(parseDecklistLine("Sideboard:")).toBeNull();
    expect(parseDecklistLine("SIDEBOARD")).toBeNull();
  });
});

describe("parseDecklist — full list parsing", () => {
  it("parses a mixed-format multi-line list and separates skipped lines", () => {
    const input = [
      "Deck",
      "4 Lightning Bolt",
      "4x Counterspell",
      "1 Black Lotus (LEA) 232",
      "2 Brainstorm [LEA]",
      "",
      "// comment",
      "Sideboard:",
      "3 Pyroblast",
    ].join("\n");

    const result = parseDecklist(input);

    expect(result.lines).toHaveLength(5);
    expect(result.lines.map((line) => line.name)).toEqual([
      "Lightning Bolt",
      "Counterspell",
      "Black Lotus",
      "Brainstorm",
      "Pyroblast",
    ]);
    expect(result.skippedLines).toEqual(["Deck", "// comment", "Sideboard:"]);
  });

  it("handles Windows-style CRLF line endings", () => {
    const result = parseDecklist("4 Lightning Bolt\r\n2 Counterspell\r\n");
    expect(result.lines).toHaveLength(2);
  });

  it("returns an empty result for an empty or whitespace-only input", () => {
    expect(parseDecklist("")).toEqual({ lines: [], skippedLines: [] });
    expect(parseDecklist("   \n  \n")).toEqual({ lines: [], skippedLines: [] });
  });
});
