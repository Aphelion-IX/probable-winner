"use server";

// Stocktake counting (backlog B-065, blueprint §8.4). Counting is ordinary
// staff data entry directly against stocktakes/stocktake_lines -- per
// 20260723063559_stocktakes.sql's own header, these two tables are a
// worksheet, not the protected ledger. Only the reconciliation step (turning
// a counted variance into a real inventory_movements row) is protected, and
// that already happens entirely in the background: marking a stocktake
// completed fires a database trigger that enqueues the stock_reconciliation
// queue, which apps/worker's reconcileStocktake() drains by calling
// adjust_inventory() per variance (AGENTS.md rules 2 and 12) -- nothing in
// this file writes to inventory_movements or inventory_balances at all.
import { createServerSupabaseClient } from "@/server/supabase";
import { getStaffContext } from "@/server/staff-context";
import { logger, getRequestId } from "@/lib/logger";

export interface StocktakeSummary {
  id: string;
  status: string;
  nodeId: string;
  nodeName: string;
  notes: string | null;
  lineCount: number;
  countedCount: number;
  createdAt: string;
}

export interface StocktakeLine {
  id: string;
  skuId: string;
  cardName: string;
  setCode: string;
  collectorNumber: string;
  finish: string;
  condition: string;
  expectedQuantity: number;
  countedQuantity: number | null;
  variance: number | null;
  reconciled: boolean;
}

export interface StocktakeDetail extends StocktakeSummary {
  lines: StocktakeLine[];
}

export interface StocktakeActionResult {
  success: boolean;
  error?: string;
  stocktakeId?: string;
}

const MAX_STOCKTAKES = 100;

const STOCKTAKE_SELECT = `
  id,
  status,
  notes,
  created_at,
  fulfilment_node_id,
  node:fulfilment_nodes!inner(name),
  stocktake_lines(id, counted_quantity)
`;

interface StocktakeQueryRow {
  id: string;
  status: string;
  notes: string | null;
  created_at: string;
  fulfilment_node_id: string;
  node: { name: string } | null;
  stocktake_lines: { id: string; counted_quantity: number | null }[] | null;
}

function mapSummary(row: StocktakeQueryRow): StocktakeSummary {
  const lines = row.stocktake_lines ?? [];
  return {
    id: row.id,
    status: row.status,
    nodeId: row.fulfilment_node_id,
    nodeName: row.node?.name ?? "",
    notes: row.notes,
    lineCount: lines.length,
    countedCount: lines.filter((line) => line.counted_quantity !== null).length,
    createdAt: row.created_at,
  };
}

/** Every stocktake touching one of the staff member's nodes (RLS-scoped). */
export async function listStocktakes(): Promise<StocktakeSummary[]> {
  const staffContext = await getStaffContext();

  if (!staffContext) {
    return [];
  }

  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("stocktakes")
    .select(STOCKTAKE_SELECT)
    .order("created_at", { ascending: false })
    .limit(MAX_STOCKTAKES);

  if (error) {
    logger.error("List stocktakes failed", {
      requestId: await getRequestId(),
      error: logger.serializeError(error),
    });
    throw new Error("Failed to load stocktakes");
  }

  return ((data ?? []) as unknown as StocktakeQueryRow[]).map(mapSummary);
}

export async function getStocktake(stocktakeId: string): Promise<StocktakeDetail | null> {
  const staffContext = await getStaffContext();

  if (!staffContext) {
    return null;
  }

  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("stocktakes")
    .select(
      `
      id,
      status,
      notes,
      created_at,
      fulfilment_node_id,
      node:fulfilment_nodes!inner(name),
      stocktake_lines(
        id,
        sellable_sku_id,
        expected_quantity,
        counted_quantity,
        variance,
        reconciled,
        sku:sellable_skus!inner(
          conditions!inner(name),
          finishes!inner(name),
          card_printing:card_printings!inner(
            collector_number,
            oracle_card:oracle_cards!inner(name),
            set:sets!inner(code)
          )
        )
      )
    `,
    )
    .eq("id", stocktakeId)
    .maybeSingle();

  if (error) {
    logger.error("Get stocktake failed", {
      requestId: await getRequestId(),
      stocktakeId,
      error: logger.serializeError(error),
    });
    throw new Error("Failed to load the stocktake");
  }

  if (!data) {
    return null;
  }

  interface LineQueryRow {
    id: string;
    sellable_sku_id: string;
    expected_quantity: number;
    counted_quantity: number | null;
    variance: number | null;
    reconciled: boolean;
    sku: {
      conditions: { name: string } | null;
      finishes: { name: string } | null;
      card_printing: {
        collector_number: string;
        oracle_card: { name: string } | null;
        set: { code: string } | null;
      } | null;
    } | null;
  }

  const row = data as unknown as Omit<StocktakeQueryRow, "stocktake_lines"> & {
    stocktake_lines: LineQueryRow[] | null;
  };

  const lines: StocktakeLine[] = (row.stocktake_lines ?? []).map((line) => ({
    id: line.id,
    skuId: line.sellable_sku_id,
    cardName: line.sku?.card_printing?.oracle_card?.name ?? "",
    setCode: line.sku?.card_printing?.set?.code ?? "",
    collectorNumber: line.sku?.card_printing?.collector_number ?? "",
    finish: line.sku?.finishes?.name ?? "",
    condition: line.sku?.conditions?.name ?? "",
    expectedQuantity: line.expected_quantity,
    countedQuantity: line.counted_quantity,
    variance: line.variance,
    reconciled: line.reconciled,
  }));

  return {
    ...mapSummary({
      ...row,
      stocktake_lines: lines.map((line) => ({
        id: line.id,
        counted_quantity: line.countedQuantity,
      })),
    }),
    lines,
  };
}

/**
 * Creates a draft stocktake for one store and populates its lines from
 * whatever inventory_balances currently shows on hand there -- expected
 * quantity is a snapshot at creation time, not a live join, so it stays
 * stable while counting is in progress even if other stock movements
 * happen concurrently.
 */
export async function createStocktake(input: {
  nodeId: string;
  notes?: string;
}): Promise<StocktakeActionResult> {
  const staffContext = await getStaffContext();

  if (!staffContext) {
    return { success: false, error: "Not authenticated as staff" };
  }

  if (!staffContext.nodeIds.includes(input.nodeId)) {
    return { success: false, error: "That fulfilment node is outside your scope" };
  }

  if (!staffContext.permissions.includes("inventory.stocktake")) {
    return { success: false, error: "You do not have the inventory.stocktake permission" };
  }

  const supabase = await createServerSupabaseClient();

  const { data: balances, error: balancesError } = await supabase
    .from("inventory_balances")
    .select("sellable_sku_id, quantity_on_hand")
    .eq("fulfilment_node_id", input.nodeId)
    .gt("quantity_on_hand", 0);

  if (balancesError) {
    logger.error("Load balances for stocktake failed", {
      requestId: await getRequestId(),
      nodeId: input.nodeId,
      error: logger.serializeError(balancesError),
    });
    return { success: false, error: "Failed to load current stock for this store" };
  }

  if (!balances || balances.length === 0) {
    return { success: false, error: "Nothing is on hand at this store to count" };
  }

  const { data: stocktake, error: stocktakeError } = await supabase
    .from("stocktakes")
    .insert({
      organisation_id: staffContext.organisationId,
      fulfilment_node_id: input.nodeId,
      notes: input.notes?.trim() || null,
      created_by: staffContext.userId,
    })
    .select("id")
    .single();

  if (stocktakeError || !stocktake) {
    logger.error("Create stocktake failed", {
      requestId: await getRequestId(),
      nodeId: input.nodeId,
      error: logger.serializeError(stocktakeError),
    });
    return { success: false, error: stocktakeError?.message ?? "Failed to create the stocktake" };
  }

  const { error: linesError } = await supabase.from("stocktake_lines").insert(
    balances.map((balance) => ({
      stocktake_id: stocktake.id,
      fulfilment_node_id: input.nodeId,
      sellable_sku_id: balance.sellable_sku_id,
      expected_quantity: balance.quantity_on_hand,
    })),
  );

  if (linesError) {
    // The header exists but has no lines -- leave it rather than trying to
    // roll back from here (same reasoning as createTransferOrder): an
    // empty stocktake is a harmless leftover a staff member can just
    // ignore, not a state that corrupts anything downstream.
    logger.error("Create stocktake lines failed", {
      requestId: await getRequestId(),
      stocktakeId: stocktake.id,
      error: logger.serializeError(linesError),
    });
    return {
      success: false,
      error: `Stocktake created but its lines failed to save: ${linesError.message}`,
      stocktakeId: stocktake.id,
    };
  }

  return { success: true, stocktakeId: stocktake.id };
}

/**
 * Records what was actually counted for one line. Pass null to clear a
 * count back to "not yet counted". The first count entered on a draft
 * stocktake flips it to in_progress so the status reflects that counting
 * has actually started.
 */
export async function updateLineCount(
  lineId: string,
  countedQuantity: number | null,
): Promise<StocktakeActionResult> {
  const staffContext = await getStaffContext();

  if (!staffContext) {
    return { success: false, error: "Not authenticated as staff" };
  }

  if (!staffContext.permissions.includes("inventory.stocktake")) {
    return { success: false, error: "You do not have the inventory.stocktake permission" };
  }

  if (countedQuantity !== null && (!Number.isInteger(countedQuantity) || countedQuantity < 0)) {
    return { success: false, error: "Counted quantity must be zero or a positive whole number" };
  }

  const supabase = await createServerSupabaseClient();

  const { data: line, error: lineError } = await supabase
    .from("stocktake_lines")
    .update({ counted_quantity: countedQuantity, updated_at: new Date().toISOString() })
    .eq("id", lineId)
    .select("stocktake_id")
    .single();

  if (lineError || !line) {
    logger.error("Update stocktake line failed", {
      requestId: await getRequestId(),
      lineId,
      error: logger.serializeError(lineError),
    });
    return { success: false, error: lineError?.message ?? "Failed to save that count" };
  }

  const { error: statusError } = await supabase
    .from("stocktakes")
    .update({ status: "in_progress", started_at: new Date().toISOString() })
    .eq("id", line.stocktake_id)
    .eq("status", "draft");

  if (statusError) {
    // The count itself already saved -- losing the draft -> in_progress
    // flip is cosmetic (it only gates a status label, not counting or
    // reconciliation), so this is logged rather than surfaced as a failure.
    logger.error("Advance stocktake to in_progress failed", {
      requestId: await getRequestId(),
      stocktakeId: line.stocktake_id,
      error: logger.serializeError(statusError),
    });
  }

  return { success: true, stocktakeId: line.stocktake_id };
}

/**
 * Marks a stocktake completed, which fires
 * enqueue_stock_reconciliation() (20260723063559_stocktakes.sql) and puts
 * it on the stock_reconciliation queue -- apps/worker's
 * pollStockReconciliationQueue()/reconcileStocktake() then turns every
 * counted variance into an adjust_inventory() call in the background.
 * Lines never counted are simply skipped by that job (its own WHERE
 * clause excludes counted_quantity is null), so completing with some
 * lines still blank is allowed here -- the caller's UI is responsible for
 * warning about that, not this action.
 */
export async function completeStocktake(stocktakeId: string): Promise<StocktakeActionResult> {
  const staffContext = await getStaffContext();

  if (!staffContext) {
    return { success: false, error: "Not authenticated as staff" };
  }

  if (!staffContext.permissions.includes("inventory.stocktake")) {
    return { success: false, error: "You do not have the inventory.stocktake permission" };
  }

  const supabase = await createServerSupabaseClient();

  const { error } = await supabase
    .from("stocktakes")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", stocktakeId);

  if (error) {
    logger.error("Complete stocktake failed", {
      requestId: await getRequestId(),
      stocktakeId,
      error: logger.serializeError(error),
    });
    return { success: false, error: error.message };
  }

  return { success: true, stocktakeId };
}
