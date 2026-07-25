// Plain module (no "use server"): a "use server" file may only export async
// functions, so the shared constant and its type live here and are imported
// by both the action module and the inventory screen.

/**
 * The subset of inventory_movements.movement_type values a human may pick in
 * the adjustment form. The others in the check constraint
 * (20260723054622_inventory_balances_and_movements.sql) are written only by
 * the system — sale/reserve/allocate/picking by the order pipeline,
 * transfer_in/transfer_out by receive_transfer()/dispatch_transfer(),
 * quarantine by quarantine_inventory() — and must not be forgeable by hand
 * from a form, or the ledger stops meaning what it says.
 */
export const ADJUSTMENT_MOVEMENT_TYPES = [
  { value: "stocktake_adjustment", label: "Stocktake adjustment" },
  { value: "damage", label: "Damage" },
  { value: "return", label: "Customer return" },
  { value: "buylist_acquisition", label: "Buylist acquisition" },
] as const;

export type AdjustmentMovementType = (typeof ADJUSTMENT_MOVEMENT_TYPES)[number]["value"];

export function isAdjustmentMovementType(value: string): value is AdjustmentMovementType {
  return ADJUSTMENT_MOVEMENT_TYPES.some((type) => type.value === value);
}
