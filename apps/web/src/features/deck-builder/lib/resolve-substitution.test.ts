import { describe, expect, it } from "vitest";

import { resolveSubstitution, type SkuCandidate } from "./resolve-substitution";

const NM = 1;
const LP = 2;
const MP = 3;

const PREFERRED_PRINTING = "printing-a";
const OTHER_PRINTING = "printing-b";

function candidate(overrides: Partial<SkuCandidate>): SkuCandidate {
  return {
    skuId: "sku-default",
    printingId: PREFERRED_PRINTING,
    conditionCode: "nm",
    conditionSortOrder: NM,
    price: 10,
    availableQuantity: 4,
    ...overrides,
  };
}

const PREFS_NM_NO_BUDGET = {
  preferredConditionCode: "nm",
  preferredConditionSortOrder: NM,
  maxBudget: null,
};

describe("resolveSubstitution", () => {
  it("returns 'preferred' when the exact printing/condition is in stock and within budget", () => {
    const nm = candidate({ skuId: "sku-nm", price: 10, availableQuantity: 4 });

    const result = resolveSubstitution([nm], PREFERRED_PRINTING, PREFS_NM_NO_BUDGET);

    expect(result).toEqual({ status: "preferred", sku: nm });
  });

  it("substitutes a different condition of the same printing when the preferred condition is out of stock", () => {
    const nmOutOfStock = candidate({ skuId: "sku-nm", availableQuantity: 0 });
    const lpInStock = candidate({
      skuId: "sku-lp",
      conditionCode: "lp",
      conditionSortOrder: LP,
      price: 8,
      availableQuantity: 3,
    });

    const result = resolveSubstitution(
      [nmOutOfStock, lpInStock],
      PREFERRED_PRINTING,
      PREFS_NM_NO_BUDGET,
    );

    expect(result).toEqual({ status: "substituted", sku: lpInStock, reason: "condition" });
  });

  it("picks the condition closest to the preference when substituting within the same printing", () => {
    const lp = candidate({
      skuId: "sku-lp",
      conditionCode: "lp",
      conditionSortOrder: LP,
      availableQuantity: 2,
    });
    const mp = candidate({
      skuId: "sku-mp",
      conditionCode: "mp",
      conditionSortOrder: MP,
      availableQuantity: 2,
    });

    const result = resolveSubstitution([lp, mp], PREFERRED_PRINTING, PREFS_NM_NO_BUDGET);

    expect(result).toEqual({ status: "substituted", sku: lp, reason: "condition" });
  });

  it("substitutes a different printing when no condition of the preferred printing is in stock", () => {
    const preferredPrintingOutOfStock = candidate({ skuId: "sku-a", availableQuantity: 0 });
    const otherPrintingInStock = candidate({
      skuId: "sku-b",
      printingId: OTHER_PRINTING,
      price: 12,
      availableQuantity: 5,
    });

    const result = resolveSubstitution(
      [preferredPrintingOutOfStock, otherPrintingInStock],
      PREFERRED_PRINTING,
      PREFS_NM_NO_BUDGET,
    );

    expect(result).toEqual({
      status: "substituted",
      sku: otherPrintingInStock,
      reason: "printing",
    });
  });

  it("prefers the same printing over a cheaper different printing", () => {
    const samePrintingWorseCondition = candidate({
      skuId: "sku-a-lp",
      conditionCode: "lp",
      conditionSortOrder: LP,
      price: 9,
      availableQuantity: 1,
    });
    const cheaperOtherPrinting = candidate({
      skuId: "sku-b-nm",
      printingId: OTHER_PRINTING,
      price: 5,
      availableQuantity: 10,
    });

    const result = resolveSubstitution(
      [samePrintingWorseCondition, cheaperOtherPrinting],
      PREFERRED_PRINTING,
      PREFS_NM_NO_BUDGET,
    );

    expect(result).toEqual({
      status: "substituted",
      sku: samePrintingWorseCondition,
      reason: "condition",
    });
  });

  it("excludes options over budget, substituting a cheaper one within budget", () => {
    const tooExpensive = candidate({ skuId: "sku-expensive", price: 50, availableQuantity: 2 });
    const affordable = candidate({
      skuId: "sku-affordable",
      conditionCode: "lp",
      conditionSortOrder: LP,
      price: 8,
      availableQuantity: 2,
    });

    const result = resolveSubstitution([tooExpensive, affordable], PREFERRED_PRINTING, {
      preferredConditionCode: "nm",
      preferredConditionSortOrder: NM,
      maxBudget: 20,
    });

    expect(result).toEqual({ status: "substituted", sku: affordable, reason: "condition" });
  });

  it("proposes the cheapest in-stock option, flagged over_budget, when nothing fits the budget", () => {
    const cheapest = candidate({ skuId: "sku-cheapest", price: 30, availableQuantity: 1 });
    const pricier = candidate({ skuId: "sku-pricier", price: 45, availableQuantity: 3 });

    const result = resolveSubstitution([cheapest, pricier], PREFERRED_PRINTING, {
      preferredConditionCode: "nm",
      preferredConditionSortOrder: NM,
      maxBudget: 20,
    });

    expect(result).toEqual({ status: "substituted", sku: cheapest, reason: "over_budget" });
  });

  it("returns 'unavailable' when nothing is in stock regardless of budget", () => {
    const outOfStock = candidate({ availableQuantity: 0 });

    const result = resolveSubstitution([outOfStock], PREFERRED_PRINTING, PREFS_NM_NO_BUDGET);

    expect(result).toEqual({ status: "unavailable" });
  });

  it("returns 'unavailable' for an empty candidate list", () => {
    expect(resolveSubstitution([], PREFERRED_PRINTING, PREFS_NM_NO_BUDGET)).toEqual({
      status: "unavailable",
    });
  });

  it("treats no budget limit (null) as accepting any in-stock price", () => {
    const expensive = candidate({ price: 999, availableQuantity: 1 });

    const result = resolveSubstitution([expensive], PREFERRED_PRINTING, PREFS_NM_NO_BUDGET);

    expect(result).toEqual({ status: "preferred", sku: expensive });
  });
});
