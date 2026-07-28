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
 * Upper bound on how many lines one bulk-receive call will process. Exists
 * to keep a single request's worth of sequential receive_inventory() RPCs
 * bounded rather than unbounded -- a real shipment this large should be
 * split into more than one upload/scan session.
 */
export const MAX_BULK_RECEIVE_LINES = 500;

const SKU_SELECT = `
  id,
  conditions!inner(name),
  languages!inner(code),
  finishes!inner(name),
  card_printing:card_printings!inner(
    collector_number,
    oracle_card:oracle_cards!inner(name),
    set:sets!inner(code)
  )
`;

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

function mapSkuQueryRow(row: SkuQueryRow): SkuSearchResult {
  return {
    skuId: row.id,
    cardName: row.card_printing?.oracle_card?.name ?? "",
    setCode: row.card_printing?.set?.code ?? "",
    collectorNumber: row.card_printing?.collector_number ?? "",
    finish: row.finishes?.name ?? "",
    condition: row.conditions?.name ?? "",
    language: row.languages?.code ?? "",
  };
}

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

  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("sellable_skus")
    .select(SKU_SELECT)
    .ilike("card_printing.oracle_card.name", `%${term}%`)
    .limit(MAX_SKU_RESULTS);

  if (error) {
    logger.error("SKU search failed", {
      requestId: await getRequestId(),
      error: logger.serializeError(error),
    });
    throw new Error("Failed to search the catalogue");
  }

  return ((data ?? []) as unknown as SkuQueryRow[]).map(mapSkuQueryRow);
}

/**
 * Resolves raw SKU ids -- e.g. the `sku_id` column of a bulk-receive CSV
 * upload -- to display labels, so a staff member reviews a real card name
 * before submitting a batch rather than a bare UUID. Any id not found in
 * the catalogue is simply absent from the result; the caller is expected to
 * flag ids that don't come back.
 */
export async function resolveSkusById(skuIds: string[]): Promise<SkuSearchResult[]> {
  const ids = [...new Set(skuIds.filter(Boolean))].slice(0, MAX_BULK_RECEIVE_LINES);

  if (ids.length === 0) {
    return [];
  }

  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase.from("sellable_skus").select(SKU_SELECT).in("id", ids);

  if (error) {
    logger.error("Resolve SKU labels failed", {
      requestId: await getRequestId(),
      error: logger.serializeError(error),
    });
    throw new Error("Failed to look up SKUs");
  }

  return ((data ?? []) as unknown as SkuQueryRow[]).map(mapSkuQueryRow);
}

/** The most recent goods-in movements across the staff member's nodes. */
export async function listRecentReceipts(): Promise<ReceiptRow[]> {
  const staffContext = await getStaffContext();

  if (!staffContext || staffContext.nodeIds.length === 0) {
    return [];
  }

  const supabase = await createServerSupabaseClient();

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

export interface BulkReceiveLine {
  skuId: string;
  quantity: number;
}

export interface BulkReceiveLineResult extends BulkReceiveLine {
  success: boolean;
  error?: string;
}

export interface BulkReceiveResult {
  success: boolean;
  error?: string;
  batchId?: string;
  lineResults?: BulkReceiveLineResult[];
}

/**
 * Books in many SKUs at once as a single tagged batch (backlog: bulk
 * goods-in). Each line still goes through receive_inventory() individually
 * -- exactly what a human clicking "Receive" 500 times would produce, never
 * arithmetic against inventory_balances here (AGENTS.md rules 2 and 12) --
 * so one bad line (unknown SKU, insufficient permission on a retry, etc.)
 * fails in isolation rather than rolling back lines that already committed.
 * Every line in the same call shares one reference_id so the resulting
 * movements can be found together in the ledger afterwards.
 */
export async function receiveStockBulk(input: {
  nodeId: string;
  lines: BulkReceiveLine[];
  reason?: string;
}): Promise<BulkReceiveResult> {
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

  if (input.lines.length === 0) {
    return { success: false, error: "Add at least one line to receive" };
  }

  if (input.lines.length > MAX_BULK_RECEIVE_LINES) {
    return {
      success: false,
      error: `A single batch is limited to ${MAX_BULK_RECEIVE_LINES} lines -- split this shipment into more than one batch`,
    };
  }

  for (const line of input.lines) {
    if (!line.skuId) {
      return { success: false, error: "Every line needs a SKU" };
    }
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      return {
        success: false,
        error: `Line for SKU ${line.skuId} needs a positive whole quantity`,
      };
    }
  }

  const supabase = await createServerSupabaseClient();
  const batchId = crypto.randomUUID();
  const reason = input.reason?.trim() || null;
  const requestId = await getRequestId();

  const lineResults: BulkReceiveLineResult[] = [];

  // Sequential rather than Promise.all: receive_inventory() takes an
  // exclusive lock on the (node, sku) balance row via
  // lock_inventory_balance(), so concurrent calls for the same pair would
  // just serialize at the database anyway. Doing it sequentially here keeps
  // one failing line from being entangled with an uncontrolled burst of
  // concurrent connections, and keeps per-line error reporting simple.
  for (const line of input.lines) {
    const { error } = await supabase.rpc("receive_inventory", {
      p_fulfilment_node_id: input.nodeId,
      p_sellable_sku_id: line.skuId,
      p_quantity: line.quantity,
      p_reference_type: "bulk_receive",
      p_reference_id: batchId,
      p_reason: reason,
    });

    if (error) {
      logger.error("Bulk receive line failed", {
        requestId,
        nodeId: input.nodeId,
        skuId: line.skuId,
        batchId,
        error: logger.serializeError(error),
      });
    }

    lineResults.push({ ...line, success: !error, error: error?.message });
  }

  const failures = lineResults.filter((result) => !result.success);

  return {
    success: failures.length === 0,
    error:
      failures.length > 0
        ? `${failures.length} of ${lineResults.length} line(s) failed -- see details below`
        : undefined,
    batchId,
    lineResults,
  };
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

  const supabase = await createServerSupabaseClient();

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
