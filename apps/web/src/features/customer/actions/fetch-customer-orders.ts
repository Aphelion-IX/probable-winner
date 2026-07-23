"use server";

import { createServerSupabaseClient } from "@/server/supabase";
import { logger, getRequestId } from "@/lib/logger";

interface OrderRow {
  id: string;
  order_number: string;
  status: "pending" | "confirmed" | "picking" | "packed" | "shipped" | "delivered";
  fulfillment_type: "click_and_collect" | "online_shipping";
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
  card_printings: Array<{
    cards: { name: string } | null;
    sets: { name: string } | null;
  }>;
}

interface ShipmentRow {
  carrier: string;
  tracking_number: string;
  status: string;
  estimated_delivery_date: string;
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
  status: "pending" | "confirmed" | "picking" | "packed" | "shipped" | "delivered";
  fulfillment_type: "click_and_collect" | "online_shipping";
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
    carrier: string;
    tracking_number: string;
    status: string;
    estimated_delivery: string;
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
      id, order_number, status, fulfillment_type, total_amount, currency,
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

  return (orders || []).map((order: OrderRow) => ({
    id: order.id,
    order_number: order.order_number,
    status: order.status,
    fulfillment_type: order.fulfillment_type,
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
      id, order_number, status, fulfillment_type, total_amount, currency,
      order_lines(id, quantity, unit_price, card_printings(cards(name), sets(name))),
      shipments(carrier, tracking_number, status, estimated_delivery_date),
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
    fulfillment_type: typedOrder.fulfillment_type,
    total_amount: typedOrder.total_amount,
    currency: typedOrder.currency,
    line_count: (typedOrder.order_lines || []).length,
    created_at: typedOrder.created_at,
    updated_at: typedOrder.updated_at,
    order_lines: (typedOrder.order_lines || []).map((line: OrderLineRow) => ({
      id: line.id,
      card_name: line.card_printings?.[0]?.cards?.name || "Unknown",
      set_name: line.card_printings?.[0]?.sets?.name || "Unknown",
      quantity: line.quantity,
      unit_price: line.unit_price,
    })),
  };

  if (typedOrder.shipments && typedOrder.shipments.length > 0) {
    const shipment = typedOrder.shipments[0];
    detail.shipment = {
      carrier: shipment.carrier,
      tracking_number: shipment.tracking_number,
      status: shipment.status,
      estimated_delivery: shipment.estimated_delivery_date,
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
