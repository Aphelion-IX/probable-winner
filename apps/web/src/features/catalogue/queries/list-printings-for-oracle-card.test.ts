import { describe, expect, it } from "vitest";

import {
  printingsForOracleCardCacheKey,
  printingsForOracleCardCacheTag,
} from "./list-printings-for-oracle-card";

describe("printingsForOracleCardCacheKey", () => {
  it("derives a stable key scoped to the oracle card id", () => {
    expect(printingsForOracleCardCacheKey("oracle-a")).toEqual([
      "printings-for-oracle-card",
      "oracle-a",
    ]);
  });

  it("produces different keys for different oracle cards", () => {
    expect(printingsForOracleCardCacheKey("oracle-a")).not.toEqual(
      printingsForOracleCardCacheKey("oracle-b"),
    );
  });
});

describe("printingsForOracleCardCacheTag", () => {
  it("derives a tag namespaced to the oracle card id", () => {
    expect(printingsForOracleCardCacheTag("oracle-a")).toBe("printings-for-oracle-card:oracle-a");
  });
});
