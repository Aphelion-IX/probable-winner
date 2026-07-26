"use server";

// Store-to-store transfers (backlog B-070..B-072, blueprint §8.5/§12).
//
// The database already owns the hard parts: enforce_transfer_status_
// transition() rejects illegal status jumps, and dispatch_transfer() /
// receive_transfer() are the only things that move stock (decrementing the
// source on dispatch, incrementing the destination on receipt, both writing
// inventory_movements). This module is the staff-facing wrapper around them.
import { createServerSupabaseClient } from "@/server/supabase";
import { getStaffContext } from "@/server/staff-context";
import { logger, getRequestId } from "@/lib/logger";

export interface TransferSummary {
  id: string;
  status: string;
  sourceNodeId: string;
  sourceNodeName: string;
  destinationNodeId: string;
  destinationNodeName: string;
  lineCount: number;
  notes: string | null;
  createdAt: string;
}

export interface TransferLine {
  id: string;
  skuId: string;
  cardName: string;
  setCode: string;
  collectorNumber: string;
  finish: string;
  condition: string;
  quantityRequested: number;
  quantityGood: number;
  quantityDamaged: number;
  quantityMissing: number;
  /** Still to be accounted for across further partial receipts. */
  quantityOutstanding: number;
}

export interface TransferDetail extends TransferSummary {
  lines: TransferLine[];
}

export interface TransferActionResult {
  success: boolean;
  error?: string;
  transferId?: string;
}

/** Statuses a human advances by hand; dispatch/receipt use their own RPCs. */
const MANUAL_STATUSES = new Set([
  "requested",
  "accepted",
  "picking",
  "in_transit",
  "cancelled",
]);

const TRANSFER_SELECT = `
  id,
  status,
  notes,
  created_at,
  source_fulfilment_node_id,
  destination_fulfilment_node_id,
  source:fulfilment_nodes!transfer_orders_source_fulfilment_node_id_fkey(name),
  destination:fulfilment_nodes!transfer_orders_destination_fulfilment_node_id_fkey(name),
  transfer_order_lines(id)
`;

interface TransferQueryRow {
  id: string;
  status: string;
  notes: string | null;
  created_at: string;
  source_fulfilment_node_id: string;
  destination_fulfilment_node_id: string;
  source: { name: string } | null;
  destination: { name: string } | null;
  transfer_order_lines: { id: string }[] | null;
}

function mapSummary(row: TransferQueryRow): TransferSummary {
  return {
    id: row.id,
    status: row.status,
    sourceNodeId: row.source_fulfilment_node_id,
    sourceNodeName: row.source?.name ?? "",
    destinationNodeId: row.destination_fulfilment_node_id,
    destinationNodeName: row.destination?.name ?? "",
    lineCount: row.transfer_order_lines?.length ?? 0,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

/**
 * Every transfer touching one of the staff member's nodes, as source or
 * destination. RLS already restricts this (transfer_orders_select), so no
 * explicit node filter is needed — unlike inventory_balances, transfer_orders
 * has no public read policy.
 */
export async function listTransferOrders(): Promise<TransferSummary[]> {
  const staffContext = await getStaffContext();

  if (!staffContext) {
    return [];
  }

  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("transfer_orders")
    .select(TRANSFER_SELECT)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    logger.error("List transfer orders failed", {
      requestId: await getRequestId(),
      error: logger.serializeError(error),
    });
    throw new Error("Failed to load transfers");
  }

  return ((data ?? []) as unknown as TransferQueryRow[]).map(mapSummary);
}

export async function getTransferOrder(transferId: string): Promise<TransferDetail | null> {
  const staffContext = await getStaffContext();

  if (!staffContext) {
    return null;
  }

  const supabase = await createServerSupabaseClient();

  const [{ data: order, error: orderError }, { data: receipts, error: receiptsError }] =
    await Promise.all([
      supabase
        .from("transfer_orders")
        .select(
          `
          id,
          status,
          notes,
          created_at,
          source_fulfilment_node_id,
          destination_fulfilment_node_id,
          source:fulfilment_nodes!transfer_orders_source_fulfilment_node_id_fkey(name),
          destination:fulfilment_nodes!transfer_orders_destination_fulfilment_node_id_fkey(name),
          transfer_order_lines(
            id,
            sellable_sku_id,
            quantity_requested,
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
        .eq("id", transferId)
        .maybeSingle(),
      supabase
        .from("transfer_receipts")
        .select("sellable_sku_id, quantity_good, quantity_damaged, quantity_missing")
        .eq("transfer_order_id", transferId),
    ]);

  if (orderError || receiptsError) {
    logger.error("Get transfer order failed", {
      requestId: await getRequestId(),
      transferId,
      error: logger.serializeError(orderError ?? receiptsError),
    });
    throw new Error("Failed to load the transfer");
  }

  if (!order) {
    return null;
  }

  interface LineQueryRow {
    id: string;
    sellable_sku_id: string;
    quantity_requested: number;
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

  // Receipts are per (line, session) — a line can have several across
  // multiple partial-receipt sessions, so they are summed per SKU here to
  // mirror what receive_transfer() itself checks against quantity_requested.
  const receivedBySku = new Map<string, { good: number; damaged: number; missing: number }>();
  for (const receipt of receipts ?? []) {
    const current = receivedBySku.get(receipt.sellable_sku_id) ?? {
      good: 0,
      damaged: 0,
      missing: 0,
    };
    receivedBySku.set(receipt.sellable_sku_id, {
      good: current.good + receipt.quantity_good,
      damaged: current.damaged + receipt.quantity_damaged,
      missing: current.missing + receipt.quantity_missing,
    });
  }

  // Omit rather than intersect: TransferQueryRow already declares
  // transfer_order_lines as { id }[], and intersecting the two shapes makes
  // every richer field on the line unreachable.
  const orderRow = order as unknown as Omit<TransferQueryRow, "transfer_order_lines"> & {
    transfer_order_lines: LineQueryRow[] | null;
  };

  const lines: TransferLine[] = (orderRow.transfer_order_lines ?? []).map((line) => {
    const received = receivedBySku.get(line.sellable_sku_id) ?? {
      good: 0,
      damaged: 0,
      missing: 0,
    };
    const accounted = received.good + received.damaged + received.missing;

    return {
      id: line.id,
      skuId: line.sellable_sku_id,
      cardName: line.sku?.card_printing?.oracle_card?.name ?? "",
      setCode: line.sku?.card_printing?.set?.code ?? "",
      collectorNumber: line.sku?.card_printing?.collector_number ?? "",
      finish: line.sku?.finishes?.name ?? "",
      condition: line.sku?.conditions?.name ?? "",
      quantityRequested: line.quantity_requested,
      quantityGood: received.good,
      quantityDamaged: received.damaged,
      quantityMissing: received.missing,
      quantityOutstanding: Math.max(0, line.quantity_requested - accounted),
    };
  });

  return {
    ...mapSummary({ ...orderRow, transfer_order_lines: lines.map((line) => ({ id: line.id })) }),
    lines,
  };
}

export async function createTransferOrder(input: {
  sourceNodeId: string;
  destinationNodeId: string;
  notes?: string;
  lines: { skuId: string; quantity: number }[];
}): Promise<TransferActionResult> {
  const staffContext = await getStaffContext();

  if (!staffContext) {
    return { success: false, error: "Not authenticated as staff" };
  }

  if (!staffContext.permissions.includes("inventory.transfer")) {
    return { success: false, error: "You do not have the inventory.transfer permission" };
  }

  if (input.sourceNodeId === input.destinationNodeId) {
    return { success: false, error: "Source and destination must be different stores" };
  }

  // The staff member must be scoped to at least one end of the transfer;
  // transfer_orders_insert enforces the same rule in RLS, this just produces
  // a readable message instead of a policy violation.
  if (
    !staffContext.nodeIds.includes(input.sourceNodeId) &&
    !staffContext.nodeIds.includes(input.destinationNodeId)
  ) {
    return { success: false, error: "Both stores are outside your scope" };
  }

  const validLines = input.lines.filter(
    (line) => line.skuId && Number.isInteger(line.quantity) && line.quantity > 0,
  );

  if (validLines.length === 0) {
    return { success: false, error: "Add at least one line with a positive quantity" };
  }

  const supabase = await createServerSupabaseClient();

  const { data: order, error: orderError } = await supabase
    .from("transfer_orders")
    .insert({
      organisation_id: staffContext.organisationId,
      source_fulfilment_node_id: input.sourceNodeId,
      destination_fulfilment_node_id: input.destinationNodeId,
      notes: input.notes?.trim() || null,
      requested_by: staffContext.userId,
    })
    .select("id")
    .single();

  if (orderError || !order) {
    logger.error("Create transfer order failed", {
      requestId: await getRequestId(),
      error: logger.serializeError(orderError),
    });
    return { success: false, error: orderError?.message ?? "Failed to create the transfer" };
  }

  const { error: linesError } = await supabase.from("transfer_order_lines").insert(
    validLines.map((line) => ({
      transfer_order_id: order.id,
      sellable_sku_id: line.skuId,
      quantity_requested: line.quantity,
    })),
  );

  if (linesError) {
    // The header exists but has no lines. Leave it as a draft rather than
    // trying to roll back from here: draft is a legitimate state, a
    // half-populated dispatched transfer would not be, and the staff member
    // can delete or finish the draft from the list.
    logger.error("Create transfer lines failed", {
      requestId: await getRequestId(),
      transferId: order.id,
      error: logger.serializeError(linesError),
    });
    return {
      success: false,
      error: `Transfer created but its lines failed to save: ${linesError.message}`,
      transferId: order.id,
    };
  }

  return { success: true, transferId: order.id };
}

/**
 * Advances a transfer through the workflow states that carry no inventory
 * effect. Dispatch and receipt are deliberately excluded — those move stock
 * and must go through dispatch_transfer()/receive_transfer().
 */
export async function updateTransferStatus(
  transferId: string,
  status: string,
): Promise<TransferActionResult> {
  const staffContext = await getStaffContext();

  if (!staffContext) {
    return { success: false, error: "Not authenticated as staff" };
  }

  if (!staffContext.permissions.includes("inventory.transfer")) {
    return { success: false, error: "You do not have the inventory.transfer permission" };
  }

  if (!MANUAL_STATUSES.has(status)) {
    return { success: false, error: `${status} is not a status you can set by hand` };
  }

  const supabase = await createServerSupabaseClient();

  const { error } = await supabase
    .from("transfer_orders")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", transferId);

  if (error) {
    logger.error("Update transfer status failed", {
      requestId: await getRequestId(),
      transferId,
      status,
      error: logger.serializeError(error),
    });
    return { success: false, error: error.message };
  }

  return { success: true, transferId };
}

export async function dispatchTransfer(transferId: string): Promise<TransferActionResult> {
  const staffContext = await getStaffContext();

  if (!staffContext) {
    return { success: false, error: "Not authenticated as staff" };
  }

  if (!staffContext.permissions.includes("inventory.transfer")) {
    return { success: false, error: "You do not have the inventory.transfer permission" };
  }

  const supabase = await createServerSupabaseClient();

  const { error } = await supabase.rpc("dispatch_transfer", {
    p_transfer_order_id: transferId,
  });

  if (error) {
    logger.error("Dispatch transfer failed", {
      requestId: await getRequestId(),
      transferId,
      error: logger.serializeError(error),
    });
    return { success: false, error: error.message };
  }

  return { success: true, transferId };
}

export async function receiveTransfer(
  transferId: string,
  lines: { skuId: string; good: number; damaged: number; missing: number }[],
): Promise<TransferActionResult> {
  const staffContext = await getStaffContext();

  if (!staffContext) {
    return { success: false, error: "Not authenticated as staff" };
  }

  if (!staffContext.permissions.includes("inventory.transfer")) {
    return { success: false, error: "You do not have the inventory.transfer permission" };
  }

  // receive_transfer() rejects a zero-quantity line (transfer_receipts_
  // nonzero), so lines the receiver left blank are dropped here rather than
  // failing the whole session.
  const payload = lines
    .filter((line) => line.good + line.damaged + line.missing > 0)
    .map((line) => ({
      sellableSkuId: line.skuId,
      quantityGood: line.good,
      quantityDamaged: line.damaged,
      quantityMissing: line.missing,
    }));

  if (payload.length === 0) {
    return { success: false, error: "Enter a quantity against at least one line" };
  }

  const supabase = await createServerSupabaseClient();

  const { error } = await supabase.rpc("receive_transfer", {
    p_transfer_order_id: transferId,
    p_lines: payload,
  });

  if (error) {
    logger.error("Receive transfer failed", {
      requestId: await getRequestId(),
      transferId,
      error: logger.serializeError(error),
    });
    return { success: false, error: error.message };
  }

  return { success: true, transferId };
}
