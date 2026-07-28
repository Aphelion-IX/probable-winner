import { describe, expect, it } from "vitest";

import { isUuid } from "./is-uuid";

describe("isUuid", () => {
  it("accepts a well-formed uuid", () => {
    expect(isUuid("11111111-1111-1111-1111-111111111111")).toBe(true);
  });

  it("accepts uppercase hex digits", () => {
    expect(isUuid("AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE")).toBe(true);
  });

  it("rejects the literal string 'undefined'", () => {
    expect(isUuid("undefined")).toBe(false);
  });

  it("rejects a card name", () => {
    expect(isUuid("Lightning Bolt")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isUuid("")).toBe(false);
  });

  it("rejects a uuid missing a segment", () => {
    expect(isUuid("11111111-1111-1111-1111")).toBe(false);
  });
});
