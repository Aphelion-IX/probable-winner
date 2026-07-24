"use server";

import { createServerSupabaseClient } from "@/server/supabase";
import { logger, getRequestId } from "@/lib/logger";

// Matches orders.status's real CHECK constraint
// (20260723081706_orders_and_shipments_v2.sql) -- there is no "confirmed"
// status, and "paid"/"dispatched"/"cancelled" were previously missing here.
export type OrderStatus =
  "pending" | "paid" | "picking" | "packed" | "dispatched" | "shipped" | "delivered" | "cancelled";

interface OrderRow {
  id: string;
  order_number: string;
  status: OrderStatus;
  fulfilment_type: "click_and_collect" | "online_shipping";
  total_amount: number;
  currency: string;
  order_lines: Array<{ id: string }>;
  created_at: string;
  updated_at: string;
}

interface OrderLineRow {
  id: string;
  quantity: number;
  unit_price: number;
  // order_lines only has sellable_sku_id -- there is no direct card_printings
  // embed (20260723081706_orders_and_shipments_v2.sql). The real path is
  // sellable_sku_id -> sellable_skus.card_printing_id -> card_printings,
  // and the card table is oracle_cards, not "cards"
  // (20260722113833_catalogue_core_tables.sql).
  sellable_skus: Array<{
    card_printings: Array<{
      oracle_cards: { name: string } | null;
      sets: { name: string } | null;
    }> | null;
  }> | null;
}

interface ShipmentRow {
  carrier: string | null;
  tracking_number: string | null;
  // Real columns are carrier_status/shipped_at/delivered_at, not
  // status/estimated_delivery_date (20260723081706_orders_and_shipments_v2.sql).
  carrier_status: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
}

interface HandoverRow {
  handed_over_at: string;
  notes: string | null;
}

interface OrderDetailRow extends OrderRow {
  order_lines: OrderLineRow[];
  shipments: ShipmentRow[];
  order_handovers: HandoverRow[];
}

export interface CustomerOrderSummary {
  id: string;
  order_number: string;
  status: OrderStatus;
  fulfilment_type: "click_and_collect" | "online_shipping";
  total_amount: number;
  currency: string;
  line_count: number;
  created_at: string;
  updated_at: string;
}

export interface CustomerOrderDetail extends CustomerOrderSummary {
  order_lines: Array<{
    id: string;
    card_name: string;
    set_name: string;
    quantity: number;
    unit_price: number;
  }>;
  shipment?: {
    carrier: string | null;
    tracking_number: string | null;
    carrier_status: string | null;
    shipped_at: string | null;
    delivered_at: string | null;
  };
  handover?: {
    handed_over_at: string;
    notes: string | null;
  };
}

export async function fetchCustomerOrders(limit: number = 20): Promise<CustomerOrderSummary[]> {
  const supabase = createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  const { data: orders, error } = await supabase
    .from("orders")
    .select(
      `
      id, order_number, status, fulfilment_type, total_amount, currency,
      order_lines(id),
      created_at, updated_at
    `,
    )
    .eq("customer_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    logger.error("Fetch customer orders failed", {
      requestId: await getRequestId(),
      customerId: user.id,
      error: logger.serializeError(error),
    });
    throw new Error("Failed to fetch orders");
  }

  return ((orders || []) as unknown as OrderRow[]).map((order) => ({
    id: order.id,
    order_number: order.order_number,
    status: order.status,
    fulfilment_type: order.fulfilment_type,
    total_amount: order.total_amount,
    currency: order.currency,
    line_count: (order.order_lines || []).length,
    created_at: order.created_at,
    updated_at: order.updated_at,
  }));
}

export async function fetchCustomerOrderDetail(orderId: string): Promise<CustomerOrderDetail> {
  const supabase = createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  const { data: order, error } = await supabase
    .from("orders")
    .select(
      `
      id, order_number, status, fulfilment_type, total_amount, currency,
      order_lines(id, quantity, unit_price, sellable_skus(card_printings(oracle_cards(name), sets(name)))),
      shipments(carrier, tracking_number, carrier_status, shipped_at, delivered_at),
      order_handovers(handed_over_at, notes),
      created_at, updated_at
    `,
    )
    .eq("id", orderId)
    .eq("customer_id", user.id)
    .single();

  if (error || !order) {
    logger.error("Fetch customer order detail failed", {
      requestId: await getRequestId(),
      customerId: user.id,
      orderId,
      error: error ? logger.serializeError(error) : "not found",
    });
    throw new Error("Order not found");
  }

  const typedOrder = order as unknown as OrderDetailRow;

  const detail: CustomerOrderDetail = {
    id: typedOrder.id,
    order_number: typedOrder.order_number,
    status: typedOrder.status,
    fulfilment_type: typedOrder.fulfilment_type,
    total_amount: typedOrder.total_amount,
    currency: typedOrder.currency,
    line_count: (typedOrder.order_lines || []).length,
    created_at: typedOrder.created_at,
    updated_at: typedOrder.updated_at,
    order_lines: (typedOrder.order_lines || []).map((line) => {
      const cardPrinting = line.sellable_skus?.[0]?.card_printings?.[0];
      return {
        id: line.id,
        card_name: cardPrinting?.oracle_cards?.name || "Unknown",
        set_name: cardPrinting?.sets?.name || "Unknown",
        quantity: line.quantity,
        unit_price: line.unit_price,
      };
    }),
  };

  if (typedOrder.shipments && typedOrder.shipments.length > 0) {
    const shipment = typedOrder.shipments[0];
    detail.shipment = {
      carrier: shipment.carrier,
      tracking_number: shipment.tracking_number,
      carrier_status: shipment.carrier_status,
      shipped_at: shipment.shipped_at,
      delivered_at: shipment.delivered_at,
    };
  }

  if (typedOrder.order_handovers && typedOrder.order_handovers.length > 0) {
    const handover = typedOrder.order_handovers[0];
    detail.handover = {
      handed_over_at: handover.handed_over_at,
      notes: handover.notes,
    };
  }

  return detail;
}
