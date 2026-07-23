import { describe, it, expect } from "vitest";
import { detectPricingReview } from "./detect-pricing-review.js";
import type { PricingReviewInput, CalculateSuggestedPriceResult } from "./detect-pricing-review.js";

const baseSuggestedPrice: CalculateSuggestedPriceResult = {
  baseAmount: 10,
  baseCurrency: "USD",
  exchangeRate: 1.55,
  convertedAmount: 15.5,
  marginAmount: 4.65,
  conditionModifierAmount: 0,
  stockModifierAmount: 0,
  finalAmount: 20.15,
  currency: "AUD",
};

const baseReviewInput: PricingReviewInput = {
  calculatedPrice: baseSuggestedPrice,
  previousApprovedPrice: null,
  priceSnapshotAgeHours: 2,
  exchangeRateAgeHours: 1,
  marginValue: 30,
  finishMatch: true,
  providedProviders: 3,
  totalAvailableProviders: 3,
  providerPriceVariationPercent: 5,
  mappingIsAmbiguous: false,
};

describe("detectPricingReview", () => {
  it("auto-approves a price with no triggers and valid thresholds", () => {
    const result = detectPricingReview(baseReviewInput);

    expect(result.triggeredConditions).toHaveLength(0);
    expect(result.shouldAutoApprove).toBe(true);
  });

  it("triggers large_movement when price change exceeds 25%", () => {
    const result = detectPricingReview({
      ...baseReviewInput,
      previousApprovedPrice: 10,
      calculatedPrice: { ...baseSuggestedPrice, finalAmount: 13 }, // 30% increase
    });

    expect(result.triggeredConditions).toContain("large_movement");
    expect(result.shouldAutoApprove).toBe(false);
  });

  it("does not trigger large_movement when price change is exactly 25%", () => {
    const result = detectPricingReview({
      ...baseReviewInput,
      previousApprovedPrice: 20,
      calculatedPrice: { ...baseSuggestedPrice, finalAmount: 25 }, // exactly 25% increase
    });

    expect(result.triggeredConditions).not.toContain("large_movement");
  });

  it("does not trigger large_movement when no previous price exists", () => {
    const result = detectPricingReview({
      ...baseReviewInput,
      previousApprovedPrice: null,
    });

    expect(result.triggeredConditions).not.toContain("large_movement");
  });

  it("triggers high_value_card when price >= $100", () => {
    const result = detectPricingReview({
      ...baseReviewInput,
      calculatedPrice: { ...baseSuggestedPrice, finalAmount: 100 },
    });

    expect(result.triggeredConditions).toContain("high_value_card");
    expect(result.shouldAutoApprove).toBe(false);
  });

  it("does not trigger high_value_card when price < $100", () => {
    const result = detectPricingReview({
      ...baseReviewInput,
      calculatedPrice: { ...baseSuggestedPrice, finalAmount: 99.99 },
    });

    expect(result.triggeredConditions).not.toContain("high_value_card");
  });

  it("triggers provider_disagreement when variation > 15%", () => {
    const result = detectPricingReview({
      ...baseReviewInput,
      providerPriceVariationPercent: 20,
    });

    expect(result.triggeredConditions).toContain("provider_disagreement");
    expect(result.shouldAutoApprove).toBe(false);
  });

  it("does not trigger provider_disagreement when variation <= 15%", () => {
    const result = detectPricingReview({
      ...baseReviewInput,
      providerPriceVariationPercent: 15,
    });

    expect(result.triggeredConditions).not.toContain("provider_disagreement");
  });

  it("does not trigger provider_disagreement when only one provider exists", () => {
    const result = detectPricingReview({
      ...baseReviewInput,
      providerPriceVariationPercent: null,
    });

    expect(result.triggeredConditions).not.toContain("provider_disagreement");
  });

  it("triggers missing_provider when only one provider has quotes", () => {
    const result = detectPricingReview({
      ...baseReviewInput,
      providedProviders: 1,
      totalAvailableProviders: 3,
      providerPriceVariationPercent: null,
    });

    expect(result.triggeredConditions).toContain("missing_provider");
    expect(result.shouldAutoApprove).toBe(false);
  });

  it("does not trigger missing_provider when multiple providers have quotes", () => {
    const result = detectPricingReview({
      ...baseReviewInput,
      providedProviders: 2,
      totalAvailableProviders: 3,
    });

    expect(result.triggeredConditions).not.toContain("missing_provider");
  });

  it("triggers stale_data when price snapshot is too old", () => {
    const result = detectPricingReview({
      ...baseReviewInput,
      priceSnapshotAgeHours: 25,
    });

    expect(result.triggeredConditions).toContain("stale_data");
    expect(result.shouldAutoApprove).toBe(false);
  });

  it("triggers stale_data when exchange rate is too old", () => {
    const result = detectPricingReview({
      ...baseReviewInput,
      exchangeRateAgeHours: 25,
    });

    expect(result.triggeredConditions).toContain("stale_data");
    expect(result.shouldAutoApprove).toBe(false);
  });

  it("does not trigger stale_data when both are current", () => {
    const result = detectPricingReview({
      ...baseReviewInput,
      priceSnapshotAgeHours: 24,
      exchangeRateAgeHours: 24,
    });

    expect(result.triggeredConditions).not.toContain("stale_data");
  });

  it("triggers uncertain_match when finish does not match", () => {
    const result = detectPricingReview({
      ...baseReviewInput,
      finishMatch: false,
    });

    expect(result.triggeredConditions).toContain("uncertain_match");
    expect(result.shouldAutoApprove).toBe(false);
  });

  it("does not trigger uncertain_match when finish matches", () => {
    const result = detectPricingReview({
      ...baseReviewInput,
      finishMatch: true,
    });

    expect(result.triggeredConditions).not.toContain("uncertain_match");
  });

  it("triggers negative_margin when margin is negative", () => {
    const result = detectPricingReview({
      ...baseReviewInput,
      marginValue: -5,
    });

    expect(result.triggeredConditions).toContain("negative_margin");
    expect(result.shouldAutoApprove).toBe(false);
  });

  it("does not trigger negative_margin when margin is positive", () => {
    const result = detectPricingReview({
      ...baseReviewInput,
      marginValue: 10,
    });

    expect(result.triggeredConditions).not.toContain("negative_margin");
  });

  it("triggers possible_mapping_error when mapping is ambiguous", () => {
    const result = detectPricingReview({
      ...baseReviewInput,
      mappingIsAmbiguous: true,
    });

    expect(result.triggeredConditions).toContain("possible_mapping_error");
    expect(result.shouldAutoApprove).toBe(false);
  });

  it("does not trigger possible_mapping_error when mapping is unambiguous", () => {
    const result = detectPricingReview({
      ...baseReviewInput,
      mappingIsAmbiguous: false,
    });

    expect(result.triggeredConditions).not.toContain("possible_mapping_error");
  });

  it("combines multiple triggers when present", () => {
    const result = detectPricingReview({
      ...baseReviewInput,
      calculatedPrice: { ...baseSuggestedPrice, finalAmount: 100 }, // triggers high_value_card
      marginValue: -5, // triggers negative_margin
      finishMatch: false, // triggers uncertain_match
    });

    expect(result.triggeredConditions).toContain("high_value_card");
    expect(result.triggeredConditions).toContain("negative_margin");
    expect(result.triggeredConditions).toContain("uncertain_match");
    expect(result.triggeredConditions).toHaveLength(3);
    expect(result.shouldAutoApprove).toBe(false);
  });

  it("does not auto-approve when margin is below 10% minimum", () => {
    const result = detectPricingReview({
      ...baseReviewInput,
      marginValue: 9.99,
    });

    expect(result.shouldAutoApprove).toBe(false);
  });

  it("auto-approves when margin is exactly 10%", () => {
    const result = detectPricingReview({
      ...baseReviewInput,
      marginValue: 10,
    });

    expect(result.shouldAutoApprove).toBe(true);
  });

  it("prevents auto-approval for prices at or above high-value threshold", () => {
    const result = detectPricingReview({
      ...baseReviewInput,
      calculatedPrice: { ...baseSuggestedPrice, finalAmount: 100 },
    });

    expect(result.shouldAutoApprove).toBe(false);
  });

  it("prevents auto-approval when price snapshot is stale", () => {
    const result = detectPricingReview({
      ...baseReviewInput,
      priceSnapshotAgeHours: 25,
    });

    expect(result.shouldAutoApprove).toBe(false);
  });

  it("prevents auto-approval when exchange rate is stale", () => {
    const result = detectPricingReview({
      ...baseReviewInput,
      exchangeRateAgeHours: 25,
    });

    expect(result.shouldAutoApprove).toBe(false);
  });

  it("handles large price decrease (no false positive for large movement)", () => {
    const result = detectPricingReview({
      ...baseReviewInput,
      previousApprovedPrice: 100,
      calculatedPrice: { ...baseSuggestedPrice, finalAmount: 70 }, // 30% decrease
    });

    expect(result.triggeredConditions).toContain("large_movement");
  });

  it("allows price to remain stable with no previous price context", () => {
    const result = detectPricingReview({
      ...baseReviewInput,
      previousApprovedPrice: null,
      calculatedPrice: { ...baseSuggestedPrice, finalAmount: 50 }, // hypothetically large change from unknown base
    });

    // Without previous price, large_movement cannot be triggered
    expect(result.triggeredConditions).not.toContain("large_movement");
  });
});
