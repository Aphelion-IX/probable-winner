import { describe, expect, it } from "vitest";

import { listSkuOptions, skuOptionsCacheKey, skuOptionsCacheTag } from "./list-sku-options";

describe("listSkuOptions", () => {
  it("returns an empty array for a malformed id without querying the database", async () => {
    // Same reasoning as get-card-identity.test.ts: no @/server/supabase mock
    // exists here, so resolving instead of throwing proves the uuid-shape
    // guard short-circuits before any database call.
    await expect(listSkuOptions("undefined")).resolves.toEqual([]);
  });
});

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
