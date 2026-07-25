"use server";

// Staff inventory search + corrections (backlog Step 7 / blueprint §9).
//
// Every write here goes through an atomic database function
// (adjust_inventory / quarantine_inventory / release_inventory_quarantine),
// never arithmetic against inventory_balances -- AGENTS.md rules 2 and 12:
// balances are derived from the immutable inventory_movements ledger.
import { createServerSupabaseClient } from "@/server/supabase";
import { getStaffContext } from "@/server/staff-context";
import { logger, getRequestId } from "@/lib/logger";
import {
  isAdjustmentMovementType,
  type AdjustmentMovementType,
} from "@/features/staff/inventory-movement-types";

export interface InventoryRow {
  id: string;
  nodeId: string;
  nodeName: string;
  skuId: string;
  cardName: string;
  setCode: string;
  collectorNumber: string;
  finish: string;
  condition: string;
  language: string;
  onHand: number;
  reserved: number;
  allocated: number;
  picking: number;
  quarantined: number;
  availableOnline: number;
}

export interface QuarantineRow {
  id: string;
  nodeId: string;
  nodeName: string;
  skuId: string;
  cardName: string;
  setCode: string;
  collectorNumber: string;
  quantity: number;
  reason: string;
  createdAt: string;
}

const MAX_RESULTS = 100;

interface BalanceQueryRow {
  id: string;
  fulfilment_node_id: string;
  sellable_sku_id: string;
  quantity_on_hand: number;
  quantity_reserved: number;
  quantity_allocated: number;
  quantity_picking: number;
  quantity_quarantined: number;
  quantity_available_online: number;
  node: { name: string } | null;
  sku: {
    conditions: { name: string } | null;
    languages: { code: string } | null;
    finishes: { name: string } | null;
    card_printing: {
      collector_number: string;
      oracle_card: { name: string } | null;
      set: { code: string } | null;
    } | null;
  } | null;
}

const BALANCE_SELECT = `
  id,
  fulfilment_node_id,
  sellable_sku_id,
  quantity_on_hand,
  quantity_reserved,
  quantity_allocated,
  quantity_picking,
  quantity_quarantined,
  quantity_available_online,
  node:fulfilment_nodes!inner(name),
  sku:sellable_skus!inner(
    conditions!inner(name),
    languages!inner(code),
    finishes!inner(name),
    card_printing:card_printings!inner(
      collector_number,
      oracle_card:oracle_cards!inner(name),
      set:sets!inner(code)
    )
  )
`;

function mapBalanceRow(row: BalanceQueryRow): InventoryRow {
  const printing = row.sku?.card_printing;

  return {
    id: row.id,
    nodeId: row.fulfilment_node_id,
    nodeName: row.node?.name ?? "",
    skuId: row.sellable_sku_id,
    cardName: printing?.oracle_card?.name ?? "",
    setCode: printing?.set?.code ?? "",
    collectorNumber: printing?.collector_number ?? "",
    finish: row.sku?.finishes?.name ?? "",
    condition: row.sku?.conditions?.name ?? "",
    language: row.sku?.languages?.code ?? "",
    onHand: row.quantity_on_hand,
    reserved: row.quantity_reserved,
    allocated: row.quantity_allocated,
    picking: row.quantity_picking,
    quarantined: row.quantity_quarantined,
    availableOnline: row.quantity_available_online,
  };
}

/**
 * Searches stock across the staff member's scoped nodes, optionally narrowed
 * to one node and/or a card-name substring.
 *
 * The node filter is applied explicitly rather than relying on RLS:
 * inventory_balances carries a public read policy for every active node
 * (20260725120000, so the storefront can show availability), which means RLS
 * alone would happily return stock from stores this staff member has no
 * scope over.
 */
export async function searchInventory(options: {
  query?: string;
  nodeId?: string;
}): Promise<InventoryRow[]> {
  const staffContext = await getStaffContext();

  if (!staffContext || staffContext.nodeIds.length === 0) {
    return [];
  }

  const nodeIds =
    options.nodeId && staffContext.nodeIds.includes(options.nodeId)
      ? [options.nodeId]
      : staffContext.nodeIds;

  const supabase = createServerSupabaseClient();

  let query = supabase
    .from("inventory_balances")
    .select(BALANCE_SELECT)
    .in("fulfilment_node_id", nodeIds)
    .gt("quantity_on_hand", 0)
    .order("quantity_on_hand", { ascending: false })
    .limit(MAX_RESULTS);

  const searchTerm = options.query?.trim();
  if (searchTerm) {
    query = query.ilike("sku.card_printing.oracle_card.name", `%${searchTerm}%`);
  }

  const { data, error } = await query;

  if (error) {
    logger.error("Inventory search failed", {
      requestId: await getRequestId(),
      error: logger.serializeError(error),
    });
    throw new Error("Failed to search inventory");
  }

  return ((data ?? []) as unknown as BalanceQueryRow[]).map(mapBalanceRow);
}

/** Currently-quarantined stock across the staff member's scoped nodes. */
export async function listQuarantinedStock(): Promise<QuarantineRow[]> {
  const staffContext = await getStaffContext();

  if (!staffContext || staffContext.nodeIds.length === 0) {
    return [];
  }

  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("quarantined_inventory")
    .select(
      `
      id,
      fulfilment_node_id,
      sellable_sku_id,
      quantity,
      reason,
      created_at,
      node:fulfilment_nodes!inner(name),
      sku:sellable_skus!inner(
        card_printing:card_printings!inner(
          collector_number,
          oracle_card:oracle_cards!inner(name),
          set:sets!inner(code)
        )
      )
    `,
    )
    .eq("status", "quarantined")
    .in("fulfilment_node_id", staffContext.nodeIds)
    .order("created_at", { ascending: false })
    .limit(MAX_RESULTS);

  if (error) {
    logger.error("List quarantined stock failed", {
      requestId: await getRequestId(),
      error: logger.serializeError(error),
    });
    throw new Error("Failed to load quarantined stock");
  }

  interface QuarantineQueryRow {
    id: string;
    fulfilment_node_id: string;
    sellable_sku_id: string;
    quantity: number;
    reason: string;
    created_at: string;
    node: { name: string } | null;
    sku: {
      card_printing: {
        collector_number: string;
        oracle_card: { name: string } | null;
        set: { code: string } | null;
      } | null;
    } | null;
  }

  return ((data ?? []) as unknown as QuarantineQueryRow[]).map((row) => ({
    id: row.id,
    nodeId: row.fulfilment_node_id,
    nodeName: row.node?.name ?? "",
    skuId: row.sellable_sku_id,
    cardName: row.sku?.card_printing?.oracle_card?.name ?? "",
    setCode: row.sku?.card_printing?.set?.code ?? "",
    collectorNumber: row.sku?.card_printing?.collector_number ?? "",
    quantity: row.quantity,
    reason: row.reason,
    createdAt: row.created_at,
  }));
}

export interface InventoryActionResult {
  success: boolean;
  error?: string;
}

/**
 * Applies a signed correction via adjust_inventory(). A positive delta adds
 * stock, a negative delta removes it; the database function is what writes
 * the movement row and recomputes the balance.
 */
export async function adjustStock(input: {
  nodeId: string;
  skuId: string;
  movementType: AdjustmentMovementType;
  quantityDelta: number;
  reason: string;
}): Promise<InventoryActionResult> {
  const staffContext = await getStaffContext();

  if (!staffContext) {
    return { success: false, error: "Not authenticated as staff" };
  }

  if (!staffContext.nodeIds.includes(input.nodeId)) {
    return { success: false, error: "That fulfilment node is outside your scope" };
  }

  if (!staffContext.permissions.includes("inventory.adjust")) {
    return { success: false, error: "You do not have the inventory.adjust permission" };
  }

  // Re-checked server-side: the form only offers these four, but the action
  // is a public endpoint and movement_type decides what the ledger claims
  // happened. Nothing should be able to book a hand adjustment as a "sale".
  if (!isAdjustmentMovementType(input.movementType)) {
    return { success: false, error: "Unsupported adjustment type" };
  }

  if (!Number.isInteger(input.quantityDelta) || input.quantityDelta === 0) {
    return { success: false, error: "Enter a non-zero whole quantity" };
  }

  if (!input.reason.trim()) {
    return { success: false, error: "A reason is required for every adjustment" };
  }

  const supabase = createServerSupabaseClient();

  const { error } = await supabase.rpc("adjust_inventory", {
    p_fulfilment_node_id: input.nodeId,
    p_sellable_sku_id: input.skuId,
    p_movement_type: input.movementType,
    p_quantity_delta: input.quantityDelta,
    p_reason: input.reason.trim(),
  });

  if (error) {
    logger.error("Adjust inventory failed", {
      requestId: await getRequestId(),
      nodeId: input.nodeId,
      skuId: input.skuId,
      error: logger.serializeError(error),
    });
    return { success: false, error: error.message };
  }

  return { success: true };
}

/** Moves stock out of sellable balance and into quarantine. */
export async function quarantineStock(input: {
  nodeId: string;
  skuId: string;
  quantity: number;
  reason: string;
}): Promise<InventoryActionResult> {
  const staffContext = await getStaffContext();

  if (!staffContext) {
    return { success: false, error: "Not authenticated as staff" };
  }

  if (!staffContext.nodeIds.includes(input.nodeId)) {
    return { success: false, error: "That fulfilment node is outside your scope" };
  }

  if (!staffContext.permissions.includes("inventory.adjust")) {
    return { success: false, error: "You do not have the inventory.adjust permission" };
  }

  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    return { success: false, error: "Enter a positive whole quantity" };
  }

  if (!input.reason.trim()) {
    return { success: false, error: "A reason is required to quarantine stock" };
  }

  const supabase = createServerSupabaseClient();

  const { error } = await supabase.rpc("quarantine_inventory", {
    p_fulfilment_node_id: input.nodeId,
    p_sellable_sku_id: input.skuId,
    p_quantity: input.quantity,
    p_reason: input.reason.trim(),
  });

  if (error) {
    logger.error("Quarantine inventory failed", {
      requestId: await getRequestId(),
      nodeId: input.nodeId,
      skuId: input.skuId,
      error: logger.serializeError(error),
    });
    return { success: false, error: error.message };
  }

  return { success: true };
}

/** Returns a quarantined batch to sellable stock. */
export async function releaseQuarantine(quarantineId: string): Promise<InventoryActionResult> {
  const staffContext = await getStaffContext();

  if (!staffContext) {
    return { success: false, error: "Not authenticated as staff" };
  }

  if (!staffContext.permissions.includes("inventory.adjust")) {
    return { success: false, error: "You do not have the inventory.adjust permission" };
  }

  const supabase = createServerSupabaseClient();

  const { error } = await supabase.rpc("release_inventory_quarantine", {
    p_quarantine_id: quarantineId,
  });

  if (error) {
    logger.error("Release quarantine failed", {
      requestId: await getRequestId(),
      quarantineId,
      error: logger.serializeError(error),
    });
    return { success: false, error: error.message };
  }

  return { success: true };
}
