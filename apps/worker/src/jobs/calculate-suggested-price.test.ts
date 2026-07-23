import { describe, it, expect } from "vitest";
import { calculateSuggestedPrice } from "./calculate-suggested-price.js";

describe("calculateSuggestedPrice", () => {
  it("applies currency conversion alone", () => {
    const result = calculateSuggestedPrice({
      baseAmount: 10,
      baseCurrency: "USD",
      targetCurrency: "AUD",
      exchangeRate: 1.55,
      marginType: "flat",
      marginValue: 0,
      conditionModifier: null,
      stockModifier: null,
    });

    expect(result.baseAmount).toBe(10);
    expect(result.exchangeRate).toBe(1.55);
    expect(result.convertedAmount).toBe(15.5);
    expect(result.marginAmount).toBe(0);
    expect(result.finalAmount).toBe(15.5);
  });

  it("applies percentage margin to converted amount", () => {
    const result = calculateSuggestedPrice({
      baseAmount: 10,
      baseCurrency: "USD",
      targetCurrency: "AUD",
      exchangeRate: 1.55,
      marginType: "percentage",
      marginValue: 30,
      conditionModifier: null,
      stockModifier: null,
    });

    // convertedAmount: 10 * 1.55 = 15.5
    // marginAmount: 15.5 * (30 / 100) = 4.65
    // finalAmount: 15.5 + 4.65 = 20.15
    expect(result.convertedAmount).toBe(15.5);
    expect(result.marginAmount).toBe(4.65);
    expect(result.finalAmount).toBe(20.15);
  });

  it("applies flat margin to converted amount", () => {
    const result = calculateSuggestedPrice({
      baseAmount: 10,
      baseCurrency: "USD",
      targetCurrency: "AUD",
      exchangeRate: 1.55,
      marginType: "flat",
      marginValue: 2,
      conditionModifier: null,
      stockModifier: null,
    });

    // convertedAmount: 10 * 1.55 = 15.5
    // marginAmount: 2 (flat)
    // finalAmount: 15.5 + 2 = 17.5
    expect(result.convertedAmount).toBe(15.5);
    expect(result.marginAmount).toBe(2);
    expect(result.finalAmount).toBe(17.5);
  });

  it("applies percentage condition modifier to post-margin amount", () => {
    const result = calculateSuggestedPrice({
      baseAmount: 10,
      baseCurrency: "USD",
      targetCurrency: "AUD",
      exchangeRate: 1.55,
      marginType: "percentage",
      marginValue: 30,
      conditionModifier: { type: "percentage", value: -15 },
      stockModifier: null,
    });

    // convertedAmount: 15.5
    // marginAmount: 4.65
    // afterMargin: 20.15
    // conditionModifierAmount: 20.15 * (-15 / 100) = -3.0225 → -3.02
    // finalAmount: 20.15 - 3.02 = 17.13
    expect(result.convertedAmount).toBe(15.5);
    expect(result.marginAmount).toBe(4.65);
    expect(result.conditionModifierAmount).toBe(-3.02);
    expect(result.finalAmount).toBe(17.13);
  });

  it("applies flat condition modifier to post-margin amount", () => {
    const result = calculateSuggestedPrice({
      baseAmount: 10,
      baseCurrency: "USD",
      targetCurrency: "AUD",
      exchangeRate: 1.55,
      marginType: "flat",
      marginValue: 2,
      conditionModifier: { type: "flat", value: -0.5 },
      stockModifier: null,
    });

    // convertedAmount: 15.5
    // marginAmount: 2
    // afterMargin: 17.5
    // conditionModifierAmount: -0.5 (flat)
    // finalAmount: 17.5 - 0.5 = 17
    expect(result.convertedAmount).toBe(15.5);
    expect(result.marginAmount).toBe(2);
    expect(result.conditionModifierAmount).toBe(-0.5);
    expect(result.finalAmount).toBe(17);
  });

  it("applies percentage stock modifier to post-condition amount", () => {
    const result = calculateSuggestedPrice({
      baseAmount: 10,
      baseCurrency: "USD",
      targetCurrency: "AUD",
      exchangeRate: 1.55,
      marginType: "percentage",
      marginValue: 30,
      conditionModifier: { type: "percentage", value: -15 },
      stockModifier: { type: "percentage", value: -10 },
    });

    // convertedAmount: 15.5
    // marginAmount: 4.65
    // afterMargin: 20.15
    // conditionModifierAmount: -3.02
    // afterCondition: 17.13
    // stockModifierAmount: 17.13 * (-10 / 100) = -1.713 → -1.71
    // finalAmount: 17.13 - 1.71 = 15.42
    expect(result.convertedAmount).toBe(15.5);
    expect(result.marginAmount).toBe(4.65);
    expect(result.conditionModifierAmount).toBe(-3.02);
    expect(result.stockModifierAmount).toBe(-1.71);
    expect(result.finalAmount).toBe(15.42);
  });

  it("applies flat stock modifier to post-condition amount", () => {
    const result = calculateSuggestedPrice({
      baseAmount: 10,
      baseCurrency: "USD",
      targetCurrency: "AUD",
      exchangeRate: 1.55,
      marginType: "flat",
      marginValue: 2,
      conditionModifier: { type: "flat", value: -0.5 },
      stockModifier: { type: "flat", value: -1 },
    });

    // convertedAmount: 15.5
    // marginAmount: 2
    // afterMargin: 17.5
    // conditionModifierAmount: -0.5
    // afterCondition: 17
    // stockModifierAmount: -1 (flat)
    // finalAmount: 17 - 1 = 16
    expect(result.convertedAmount).toBe(15.5);
    expect(result.marginAmount).toBe(2);
    expect(result.conditionModifierAmount).toBe(-0.5);
    expect(result.stockModifierAmount).toBe(-1);
    expect(result.finalAmount).toBe(16);
  });

  it("floors final amount at zero when discounts stack aggressively", () => {
    const result = calculateSuggestedPrice({
      baseAmount: 10,
      baseCurrency: "USD",
      targetCurrency: "AUD",
      exchangeRate: 1.55,
      marginType: "percentage",
      marginValue: 20,
      conditionModifier: { type: "percentage", value: -100 },
      stockModifier: { type: "percentage", value: -50 },
    });

    // convertedAmount: 15.5
    // marginAmount: 3.1
    // afterMargin: 18.6
    // conditionModifierAmount: -18.6 (100% off margin+converted)
    // afterCondition: 0
    // stockModifierAmount: 0
    // finalAmount: 0 (floored)
    expect(result.finalAmount).toBe(0);
  });

  it("maintains two-decimal precision through rounding", () => {
    const result = calculateSuggestedPrice({
      baseAmount: 0.99,
      baseCurrency: "USD",
      targetCurrency: "AUD",
      exchangeRate: 1.111,
      marginType: "percentage",
      marginValue: 33.33,
      conditionModifier: { type: "percentage", value: -7.77 },
      stockModifier: null,
    });

    // All intermediate values should be rounded to 2 decimals
    expect(result.convertedAmount).toBe(1.1);
    expect(result.marginAmount).toBe(0.37);
    expect(result.conditionModifierAmount).toBe(-0.11);
    // Check that all amounts have at most 2 decimal places
    const decimalPlaces = (value: number) => {
      const match = String(value).match(/\.(\d+)/);
      return match ? match[1].length : 0;
    };
    expect(decimalPlaces(result.finalAmount)).toBeLessThanOrEqual(2);
  });

  it("returns all components for traceability", () => {
    const input = {
      baseAmount: 10,
      baseCurrency: "USD",
      targetCurrency: "AUD",
      exchangeRate: 1.55,
      marginType: "percentage" as const,
      marginValue: 30,
      conditionModifier: { type: "percentage" as const, value: -15 },
      stockModifier: { type: "percentage" as const, value: -10 },
    };

    const result = calculateSuggestedPrice(input);

    expect(result).toMatchObject({
      baseAmount: input.baseAmount,
      baseCurrency: input.baseCurrency,
      exchangeRate: input.exchangeRate,
      currency: input.targetCurrency,
    });
    expect(result.convertedAmount).toBeDefined();
    expect(result.marginAmount).toBeDefined();
    expect(result.conditionModifierAmount).toBeDefined();
    expect(result.stockModifierAmount).toBeDefined();
    expect(result.finalAmount).toBeDefined();
  });
});
