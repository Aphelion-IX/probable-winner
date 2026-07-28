// Plain module (no "use server"): a "use server" file may only export async
// functions (same reasoning as inventory-movement-types.ts), so these shared
// constants live here and are imported by both the action module and the
// customer directory screen.

export const CREDIT_ENTRY_TYPES = [
  { value: "trade_in", label: "Trade-in" },
  { value: "goodwill", label: "Goodwill" },
  { value: "refund", label: "Refund as credit" },
  { value: "correction", label: "Correction" },
] as const;

export const DEBIT_ENTRY_TYPES = [
  { value: "redemption", label: "Redemption" },
  { value: "correction", label: "Correction" },
] as const;

export type CreditEntryType = (typeof CREDIT_ENTRY_TYPES)[number]["value"];
export type DebitEntryType = (typeof DEBIT_ENTRY_TYPES)[number]["value"];
