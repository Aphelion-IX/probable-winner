"use server";

// Operates on packing_shipments (staff packing workflow: weight, dimensions,
// carrier label) -- distinct from the customer-facing "shipments" table
// (order tracking info), see @/features/customer/actions/fetch-customer-orders.ts.
import { createServerSupabaseClient } from "@/server/supabase";
import { getStaffContext } from "@/server/staff-context";
import { logger, getRequestId } from "@/lib/logger";

export interface ShipmentCarrier {
  id: string;
  code: string;
  name: string;
}

/** A shipment as shown in the cross-batch dispatch queue. */
export interface ShipmentQueueItem {
  id: string;
  status: string;
  nodeName: string;
  pickBatchId: string;
  carrierName: string | null;
  trackingNumber: string | null;
  labelUrl: string | null;
  weightKg: number | null;
  packedAt: string | null;
  shippedAt: string | null;
  createdAt: string;
}

export interface Shipment {
  id: string;
  pick_batch_id: string;
  carrier_id: string | null;
  carrier: ShipmentCarrier | null;
  status: "pending" | "packed" | "labeled" | "ready_to_ship" | "shipped" | "cancelled";
  tracking_number: string | null;
  weight_kg: number | null;
  label_url: string | null;
  packed_at: string | null;
  shipped_at: string | null;
  created_at: string;
}

/**
 * Every shipment across the staff member's nodes, newest first — the dispatch
 * desk's working queue, as opposed to getShipmentsForBatch()'s single-batch
 * view used inside the packing flow.
 *
 * Scoped through the parent pick batch: packing_shipments has no
 * fulfilment_node_id of its own, the batch it belongs to does.
 */
export async function listShipments(): Promise<ShipmentQueueItem[]> {
  const staffContext = await getStaffContext();

  if (!staffContext || staffContext.nodeIds.length === 0) {
    return [];
  }

  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("packing_shipments")
    .select(
      `
      id,
      status,
      pick_batch_id,
      tracking_number,
      label_url,
      weight_kg,
      packed_at,
      shipped_at,
      created_at,
      carrier:shipment_carriers(name),
      batch:pick_batches!inner(
        fulfilment_node_id,
        node:fulfilment_nodes!inner(name)
      )
    `,
    )
    .in("batch.fulfilment_node_id", staffContext.nodeIds)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    logger.error("List shipments failed", {
      requestId: await getRequestId(),
      error: logger.serializeError(error),
    });
    throw new Error("Failed to load shipments");
  }

  interface ShipmentQueueRow {
    id: string;
    status: string;
    pick_batch_id: string;
    tracking_number: string | null;
    label_url: string | null;
    weight_kg: number | null;
    packed_at: string | null;
    shipped_at: string | null;
    created_at: string;
    carrier: { name: string } | null;
    batch: { node: { name: string } | null } | null;
  }

  return ((data ?? []) as unknown as ShipmentQueueRow[]).map((row) => ({
    id: row.id,
    status: row.status,
    nodeName: row.batch?.node?.name ?? "",
    pickBatchId: row.pick_batch_id,
    carrierName: row.carrier?.name ?? null,
    trackingNumber: row.tracking_number,
    labelUrl: row.label_url,
    weightKg: row.weight_kg,
    packedAt: row.packed_at,
    shippedAt: row.shipped_at,
    createdAt: row.created_at,
  }));
}

export async function getAvailableCarriers(): Promise<ShipmentCarrier[]> {
  const supabase = createServerSupabaseClient();

  const { data: carriers, error } = await supabase
    .from("shipment_carriers")
    .select("id, code, name")
    .order("name");

  if (error) {
    logger.error("Fetch carriers failed", {
      requestId: await getRequestId(),
      error: logger.serializeError(error),
    });
    throw new Error("Failed to fetch carriers");
  }

  return carriers || [];
}

export async function createShipmentForBatch(
  batchId: string,
  carrierCode?: string,
): Promise<Shipment> {
  const supabase = createServerSupabaseClient();

  const { data: shipment, error } = await supabase.rpc("create_shipment", {
    p_pick_batch_id: batchId,
    p_carrier_code: carrierCode || null,
  });

  if (error) {
    logger.error("Create shipment failed", {
      requestId: await getRequestId(),
      batchId,
      carrierCode,
      error: logger.serializeError(error),
    });
    throw new Error(`Failed to create shipment: ${error.message}`);
  }

  if (!shipment) {
    throw new Error("Shipment was not created");
  }

  return shipment;
}

export async function generateShipmentLabel(
  shipmentId: string,
  trackingNumber?: string,
  labelUrl?: string,
): Promise<void> {
  const supabase = createServerSupabaseClient();

  const { error } = await supabase.rpc("generate_shipment_label", {
    p_shipment_id: shipmentId,
    p_tracking_number: trackingNumber || null,
    p_label_url: labelUrl || null,
  });

  if (error) {
    logger.error("Generate shipment label failed", {
      requestId: await getRequestId(),
      shipmentId,
      error: logger.serializeError(error),
    });
    throw new Error(`Failed to generate label: ${error.message}`);
  }
}

export async function markShipmentShipped(shipmentId: string): Promise<void> {
  const supabase = createServerSupabaseClient();

  const { error } = await supabase.rpc("mark_shipment_shipped", {
    p_shipment_id: shipmentId,
  });

  if (error) {
    logger.error("Mark shipment shipped failed", {
      requestId: await getRequestId(),
      shipmentId,
      error: logger.serializeError(error),
    });
    throw new Error(`Failed to mark shipment as shipped: ${error.message}`);
  }
}

export async function getShipmentsForBatch(batchId: string): Promise<Shipment[]> {
  const supabase = createServerSupabaseClient();

  const { data: shipments, error } = await supabase
    .from("packing_shipments")
    .select(
      `
      id,
      pick_batch_id,
      carrier_id,
      carrier:shipment_carriers(id, code, name),
      status,
      tracking_number,
      weight_kg,
      label_url,
      packed_at,
      shipped_at,
      created_at
    `,
    )
    .eq("pick_batch_id", batchId)
    .order("created_at", { ascending: false });

  if (error) {
    logger.error("Fetch shipments failed", {
      requestId: await getRequestId(),
      batchId,
      error: logger.serializeError(error),
    });
    throw new Error("Failed to fetch shipments");
  }

  return (
    (
      shipments as unknown as Array<{
        id: string;
        pick_batch_id: string;
        carrier_id: string | null;
        carrier: ShipmentCarrier[] | null;
        status: string;
        tracking_number: string | null;
        weight_kg: number | null;
        label_url: string | null;
        packed_at: string | null;
        shipped_at: string | null;
        created_at: string;
      }> | null
    )?.map((s) => ({
      id: s.id,
      pick_batch_id: s.pick_batch_id,
      carrier_id: s.carrier_id,
      carrier: (s.carrier as ShipmentCarrier[] | null)?.[0] || null,
      status: s.status as
        "pending" | "packed" | "labeled" | "ready_to_ship" | "shipped" | "cancelled",
      tracking_number: s.tracking_number,
      weight_kg: s.weight_kg,
      label_url: s.label_url,
      packed_at: s.packed_at,
      shipped_at: s.shipped_at,
      created_at: s.created_at,
    })) || []
  );
}
