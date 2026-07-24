// Fulfilment percentage (backlog B-184): quantity-weighted, not line-weighted
// — "58 of 60 cards" is what a customer cares about, not "2 of 3 lines",
// since a single unavailable line for a 4-of card matters more than one for
// a 1-of. Only lines with a checked outcome (post "Check pricing &
// availability") count as fulfillable; anything not yet checked (or
// genuinely unmatched in the catalogue) counts against the percentage,
// which is the correct "can I actually buy this today" preview before
// committing to cart.

export type FulfilmentLine = { quantity: number };
export type FulfilmentOutcome = { status: "preferred" | "substituted" | "unavailable" };

export function computeFulfilmentPercentage(
  lines: FulfilmentLine[],
  outcomes: Record<number, FulfilmentOutcome | undefined>,
): number {
  const totalQuantity = lines.reduce((sum, line) => sum + line.quantity, 0);
  if (totalQuantity === 0) {
    return 0;
  }

  const fulfillableQuantity = lines.reduce((sum, line, index) => {
    const outcome = outcomes[index];
    const isFulfillable = outcome !== undefined && outcome.status !== "unavailable";
    return sum + (isFulfillable ? line.quantity : 0);
  }, 0);

  return Math.round((fulfillableQuantity / totalQuantity) * 100);
}
