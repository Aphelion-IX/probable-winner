import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { groupImportedPricesByProduct } from "./import-prices.js";
import { mapAllPricesTodayToImportedPrices } from "../integrations/mtgjson/prices.js";
import type { MtgJsonAllPricesTodayResponse } from "../integrations/mtgjson/prices-types.js";

const fixturePath = fileURLToPath(
  new URL("../../tests/fixtures/mtgjson-prices-today.json", import.meta.url),
);
const pricesFixture: MtgJsonAllPricesTodayResponse = JSON.parse(readFileSync(fixturePath, "utf-8"));

describe("groupImportedPricesByProduct", () => {
  it("groups every price for the same mtgjson uuid under one key", () => {
    const prices = mapAllPricesTodayToImportedPrices(pricesFixture);
    const grouped = groupImportedPricesByProduct(prices);

    expect(grouped.size).toBe(2);
    expect(grouped.get("3dd0bd56-5340-5542-8457-646b9acd58ff")).toHaveLength(5);
    expect(grouped.get("aa000000-0000-0000-0000-00000000aa01")).toHaveLength(1);
  });

  it("does not duplicate or drop any price while grouping", () => {
    const prices = mapAllPricesTodayToImportedPrices(pricesFixture);
    const grouped = groupImportedPricesByProduct(prices);

    const total = [...grouped.values()].reduce((sum, group) => sum + group.length, 0);
    expect(total).toBe(prices.length);
  });
});
