// Substitution and budget logic (backlog B-183). Pure decision logic only —
// no DB access here; the batched query layer (get-substitution-candidates.ts)
// gathers the candidate pool this operates on.

export type SkuCandidate = {
  skuId: string;
  printingId: string;
  conditionCode: string;
  conditionSortOrder: number;
  price: number;
  availableQuantity: number;
};

export type BudgetPreferences = {
  preferredConditionCode: string;
  preferredConditionSortOrder: number;
  maxBudget: number | null;
};

export type SubstitutionOutcome<T extends SkuCandidate> =
  | { status: "preferred"; sku: T }
  | { status: "substituted"; sku: T; reason: "condition" | "printing" | "over_budget" }
  | { status: "unavailable" };

export function resolveSubstitution<T extends SkuCandidate>(
  candidates: T[],
  preferredPrintingId: string,
  preferences: BudgetPreferences,
): SubstitutionOutcome<T> {
  const inStock = candidates.filter((candidate) => candidate.availableQuantity > 0);

  if (inStock.length === 0) {
    return { status: "unavailable" };
  }

  const withinBudget =
    preferences.maxBudget === null
      ? inStock
      : inStock.filter((candidate) => candidate.price <= preferences.maxBudget!);

  const overBudget = withinBudget.length === 0;
  const pool = overBudget ? inStock : withinBudget;

  // Prefer: the originally selected printing, then the closest condition to
  // the customer's preference, then the cheapest option — in that order.
  const [best] = [...pool].sort((a, b) => {
    const printingRank = (candidate: T) => (candidate.printingId === preferredPrintingId ? 0 : 1);
    const printingDiff = printingRank(a) - printingRank(b);
    if (printingDiff !== 0) return printingDiff;

    const conditionDistance = (candidate: T) =>
      Math.abs(candidate.conditionSortOrder - preferences.preferredConditionSortOrder);
    const conditionDiff = conditionDistance(a) - conditionDistance(b);
    if (conditionDiff !== 0) return conditionDiff;

    return a.price - b.price;
  });

  if (overBudget) {
    return { status: "substituted", sku: best, reason: "over_budget" };
  }

  const isPreferredPrinting = best.printingId === preferredPrintingId;
  const isPreferredCondition = best.conditionCode === preferences.preferredConditionCode;

  if (isPreferredPrinting && isPreferredCondition) {
    return { status: "preferred", sku: best };
  }

  return {
    status: "substituted",
    sku: best,
    reason: isPreferredPrinting ? "condition" : "printing",
  };
}
