import type { CalculateSuggestedPriceResult } from "./calculate-suggested-price.js";

export type { CalculateSuggestedPriceResult } from "./calculate-suggested-price.js";

export type ReviewTrigger =
  | "large_movement"
  | "high_value_card"
  | "provider_disagreement"
  | "missing_provider"
  | "stale_data"
  | "uncertain_match"
  | "negative_margin"
  | "possible_mapping_error";

export type PricingReviewInput = {
  calculatedPrice: CalculateSuggestedPriceResult;
  previousApprovedPrice: number | null;
  priceSnapshotAgeHours: number;
  exchangeRateAgeHours: number;
  marginValue: number;
  finishMatch: boolean;
  providedProviders: number; // count of how many providers have quotes for this card
  totalAvailableProviders: number; // total count of providers we track (normally 3: TCGplayer, Card Kingdom, Cardmarket)
  providerPriceVariationPercent: number | null; // variation between providers (null if only one provider)
  mappingIsAmbiguous: boolean;
};

export type PricingReviewResult = {
  triggeredConditions: ReviewTrigger[];
  shouldAutoApprove: boolean;
};

const AUTO_APPROVAL_THRESHOLDS = {
  PRICE_MOVEMENT_PERCENT: 25,
  MARGIN_MINIMUM_PERCENT: 10,
  EXCHANGE_RATE_MAX_AGE_HOURS: 24,
  PRICE_SNAPSHOT_MAX_AGE_HOURS: 24,
  HIGH_VALUE_THRESHOLD: 100,
  PROVIDER_DISAGREEMENT_PERCENT: 15,
};

export function detectPricingReview(input: PricingReviewInput): PricingReviewResult {
  const triggers: ReviewTrigger[] = [];

  // Check: Negative margin
  if (input.marginValue < 0) {
    triggers.push("negative_margin");
  }

  // Check: Unusually large movement (> 25% change from previous price)
  if (input.previousApprovedPrice !== null && input.previousApprovedPrice > 0) {
    const priceChange = Math.abs(input.calculatedPrice.finalAmount - input.previousApprovedPrice);
    const changePercent = (priceChange / input.previousApprovedPrice) * 100;
    if (changePercent > AUTO_APPROVAL_THRESHOLDS.PRICE_MOVEMENT_PERCENT) {
      triggers.push("large_movement");
    }
  }

  // Check: High-value card (>= $100)
  if (input.calculatedPrice.finalAmount >= AUTO_APPROVAL_THRESHOLDS.HIGH_VALUE_THRESHOLD) {
    triggers.push("high_value_card");
  }

  // Check: Provider disagreement (> 15% variation between providers)
  if (
    input.providerPriceVariationPercent !== null &&
    input.providerPriceVariationPercent > AUTO_APPROVAL_THRESHOLDS.PROVIDER_DISAGREEMENT_PERCENT
  ) {
    triggers.push("provider_disagreement");
  }

  // Check: Missing provider (only one provider has quotes)
  if (input.providedProviders < input.totalAvailableProviders && input.providedProviders === 1) {
    triggers.push("missing_provider");
  }

  // Check: Stale data (price or exchange rate too old)
  if (
    input.priceSnapshotAgeHours > AUTO_APPROVAL_THRESHOLDS.PRICE_SNAPSHOT_MAX_AGE_HOURS ||
    input.exchangeRateAgeHours > AUTO_APPROVAL_THRESHOLDS.EXCHANGE_RATE_MAX_AGE_HOURS
  ) {
    triggers.push("stale_data");
  }

  // Check: Uncertain foil/etched match
  if (!input.finishMatch) {
    triggers.push("uncertain_match");
  }

  // Check: Possible mapping error (ambiguous mapping)
  if (input.mappingIsAmbiguous) {
    triggers.push("possible_mapping_error");
  }

  // Auto-approval decision: approve only if no triggers are present
  const shouldAutoApprove =
    triggers.length === 0 &&
    input.calculatedPrice.finalAmount < AUTO_APPROVAL_THRESHOLDS.HIGH_VALUE_THRESHOLD &&
    input.marginValue >= AUTO_APPROVAL_THRESHOLDS.MARGIN_MINIMUM_PERCENT &&
    input.priceSnapshotAgeHours <= AUTO_APPROVAL_THRESHOLDS.PRICE_SNAPSHOT_MAX_AGE_HOURS &&
    input.exchangeRateAgeHours <= AUTO_APPROVAL_THRESHOLDS.EXCHANGE_RATE_MAX_AGE_HOURS;

  return {
    triggeredConditions: triggers,
    shouldAutoApprove,
  };
}
