import { describe, expect, it } from "vitest";

import { skuOptionsCacheKey, skuOptionsCacheTag } from "./list-sku-options";

describe("skuOptionsCacheKey", () => {
  it("derives a stable key scoped to the printing id", () => {
    expect(skuOptionsCacheKey("printing-a")).toEqual(["sku-options", "printing-a"]);
  });

  it("produces different keys for different printings", () => {
    expect(skuOptionsCacheKey("printing-a")).not.toEqual(skuOptionsCacheKey("printing-b"));
  });
});

describe("skuOptionsCacheTag", () => {
  it("derives a tag namespaced to the printing id", () => {
    expect(skuOptionsCacheTag("printing-a")).toBe("sku-options:printing-a");
  });
});
