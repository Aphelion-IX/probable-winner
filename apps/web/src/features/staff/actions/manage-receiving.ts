"use server";

// Goods-in: booking received stock against a fulfilment node (backlog Step 7
// / blueprint §9.3). Writes go through receive_inventory(), which appends to
// the inventory_movements ledger and recomputes the balance atomically --
// never arithmetic from here (AGENTS.md rules 2 and 12).
import { createServerSupabaseClient } from "@/server/supabase";
import { getStaffContext } from "@/server/staff-context";
import { logger, getRequestId } from "@/lib/logger";

export interface SkuSearchResult {
  skuId: string;
  cardName: string;
  setCode: string;
  collectorNumber: string;
  finish: string;
  condition: string;
  language: string;
}

export interface ReceiptRow {
  id: string;
  nodeName: string;
  cardName: string;
  setCode: string;
  collectorNumber: string;
  quantity: number;
  reason: string | null;
  createdAt: string;
}

const MAX_SKU_RESULTS = 25;
const MAX_RECEIPT_ROWS = 50;

/**
 * Finds sellable SKUs by card name so a receiver can pick the exact
 * printing/finish/condition being booked in.
 *
 * Searches the catalogue rather than existing balances on purpose: the whole
 * point of receiving is to book in stock for SKUs that currently have none,
 * which an inventory_balances-backed search would never surface.
 */
export async function searchSellableSkus(query: string): Promise<SkuSearchResult[]> {
  const term = query.trim();

  if (term.length < 2) {
    return [];
  }

  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("sellable_skus")
    .select(
      `
      id,
      conditions!inner(name),
      languages!inner(code),
      finishes!inner(name),
      card_printing:card_printings!inner(
        collector_number,
        oracle_card:oracle_cards!inner(name),
        set:sets!inner(code)
      )
    `,
    )
    .ilike("card_printing.oracle_card.name", `%${term}%`)
    .limit(MAX_SKU_RESULTS);

  if (error) {
    logger.error("SKU search failed", {
      requestId: await getRequestId(),
      error: logger.serializeError(error),
    });
    throw new Error("Failed to search the catalogue");
  }

  interface SkuQueryRow {
    id: string;
    conditions: { name: string } | null;
    languages: { code: string } | null;
    finishes: { name: string } | null;
    card_printing: {
      collector_number: string;
      oracle_card: { name: string } | null;
      set: { code: string } | null;
    } | null;
  }

  return ((data ?? []) as unknown as SkuQueryRow[]).map((row) => ({
    skuId: row.id,
    cardName: row.card_printing?.oracle_card?.name ?? "",
    setCode: row.card_printing?.set?.code ?? "",
    collectorNumber: row.card_printing?.collector_number ?? "",
    finish: row.finishes?.name ?? "",
    condition: row.conditions?.name ?? "",
    language: row.languages?.code ?? "",
  }));
}

/** The most recent goods-in movements across the staff member's nodes. */
export async function listRecentReceipts(): Promise<ReceiptRow[]> {
  const staffContext = await getStaffContext();

  if (!staffContext || staffContext.nodeIds.length === 0) {
    return [];
  }

  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("inventory_movements")
    .select(
      `
      id,
      quantity_delta,
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
    .eq("movement_type", "receive")
    .in("fulfilment_node_id", staffContext.nodeIds)
    .order("created_at", { ascending: false })
    .limit(MAX_RECEIPT_ROWS);

  if (error) {
    logger.error("List recent receipts failed", {
      requestId: await getRequestId(),
      error: logger.serializeError(error),
    });
    throw new Error("Failed to load recent receipts");
  }

  interface MovementQueryRow {
    id: string;
    quantity_delta: number;
    reason: string | null;
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

  return ((data ?? []) as unknown as MovementQueryRow[]).map((row) => ({
    id: row.id,
    nodeName: row.node?.name ?? "",
    cardName: row.sku?.card_printing?.oracle_card?.name ?? "",
    setCode: row.sku?.card_printing?.set?.code ?? "",
    collectorNumber: row.sku?.card_printing?.collector_number ?? "",
    quantity: row.quantity_delta,
    reason: row.reason,
    createdAt: row.created_at,
  }));
}

export interface ReceiveResult {
  success: boolean;
  error?: string;
}

export async function receiveStock(input: {
  nodeId: string;
  skuId: string;
  quantity: number;
  reason?: string;
}): Promise<ReceiveResult> {
  const staffContext = await getStaffContext();

  if (!staffContext) {
    return { success: false, error: "Not authenticated as staff" };
  }

  if (!staffContext.nodeIds.includes(input.nodeId)) {
    return { success: false, error: "That fulfilment node is outside your scope" };
  }

  if (!staffContext.permissions.includes("inventory.receive")) {
    return { success: false, error: "You do not have the inventory.receive permission" };
  }

  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    return { success: false, error: "Enter a positive whole quantity" };
  }

  const supabase = createServerSupabaseClient();

  const { error } = await supabase.rpc("receive_inventory", {
    p_fulfilment_node_id: input.nodeId,
    p_sellable_sku_id: input.skuId,
    p_quantity: input.quantity,
    p_reason: input.reason?.trim() || null,
  });

  if (error) {
    logger.error("Receive inventory failed", {
      requestId: await getRequestId(),
      nodeId: input.nodeId,
      skuId: input.skuId,
      error: logger.serializeError(error),
    });
    return { success: false, error: error.message };
  }

  return { success: true };
}
