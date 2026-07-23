# Pricing Rules and Auto-Approval Thresholds

This document defines the rules for suggested-price calculation, auto-approval conditions, and review triggers (blueprint §15.5).

## Auto-Approval Conditions

A suggested price is automatically approved if ALL of the following conditions are met:

1. **Exact product mapping**: The card printing is mapped to exactly one external identifier per source (TCGplayer, Card Kingdom, Cardmarket).
2. **Recent source data**: Price snapshot is from the current calendar date (no older than 24 hours).
3. **Acceptable price movement**: Price change from the previous approved price is ≤ 25%.
4. **Adequate margin**: Margin is ≥ 10% of the converted base price.
5. **Valid currency conversion**: Exchange rate was observed within the last 24 hours.
6. **No material provider disagreement**: All available provider prices for the same card agree within 15% of each other.
7. **Price below manual-review threshold**: Final suggested price is < $100 AUD.

If ANY condition is unmet, the price enters the review queue.

## Review Triggers

A suggested price is flagged for manual review if it meets any of the following conditions:

### 1. Unusually large movement
Price change from the previous approved price exceeds 25% (absolute change threshold).

### 2. High-value card
Final suggested price is ≥ $100 AUD.

### 3. Provider disagreement
Multiple active price providers quote different prices for the same card printing, and the prices disagree by > 15% (relative to the median).

### 4. Missing provider
A card is priced from only one provider (e.g., TCGplayer only, no Card Kingdom or Cardmarket quotes).

### 5. Stale data
Price snapshot is older than 24 hours (e.g., a Saturday price carried into Monday without a refresh).

### 6. Uncertain foil or etched match
The card's finish/foil status does not match exactly between the source provider and our catalogue (e.g., provider quotes "Foil" but we have "Non-Foil" SKU). Triggers a review of the matching confidence.

### 7. Negative margin
The margin calculation produces a negative value, indicating the input base price is already above the target retail price before any discounts.

### 8. Possible mapping error
The external provider's product identifier maps to multiple different oracle cards or printing IDs in our catalogue (indicating an ambiguous or incorrect mapping that requires staff review).

## Override Precedence

When a staff user manually overrides a suggested price via B-163's review UI, the override value takes precedence over all calculated suggestions. Store-level overrides (B-164) apply only to that store; organisation-wide overrides apply to all stores in the organisation unless a store has a local override.

Override precedence (highest to lowest):
1. Store-specific override (if exists)
2. Organisation-wide override (if exists)
3. Calculated suggested price (after auto-approval or staff review)

## Price Book Publication

When a price is published to the price book (B-164), all affected prices must have a status of 'approved' or 'overridden' — suggested prices cannot be published until reviewed and either approved or overridden by a user with `pricing.approve` or `pricing.override` permission.

## Historical Price Tracking

All calculated prices (including intermediate amounts: base, converted, margin, condition modifier, stock modifier, final) are stored immutably in `calculated_prices`. This enables the "staff can explain any price" requirement (blueprint §17 done criterion) — any retail price row includes a link back to the calculation that produced it.
