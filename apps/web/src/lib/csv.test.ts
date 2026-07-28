import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";

describe("parseCsv", () => {
  it("parses plain comma-separated rows", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles CRLF line endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps a comma embedded in a quoted field", () => {
    expect(parseCsv('name,qty\n"Kalitas, Traitor of Ghet",3')).toEqual([
      ["name", "qty"],
      ["Kalitas, Traitor of Ghet", "3"],
    ]);
  });

  it("unescapes a doubled quote inside a quoted field", () => {
    expect(parseCsv('note\n"she said ""hi"""')).toEqual([["note"], ['she said "hi"']]);
  });

  it("keeps a newline embedded in a quoted field", () => {
    expect(parseCsv('note\n"line one\nline two"')).toEqual([["note"], ["line one\nline two"]]);
  });

  it("ignores trailing blank lines", () => {
    expect(parseCsv("a,b\n1,2\n\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("returns an empty array for empty input", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\n\n")).toEqual([]);
  });

  it("parses a row with no trailing newline", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});
