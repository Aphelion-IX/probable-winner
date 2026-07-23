"use server";

import { createServerSupabaseClient } from "@/server/supabase";

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
    console.error("Fetch customer orders error:", error);
    throw new Error("Failed to fetch orders");
  }

  return (orders || []).map((order: any) => ({
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
    throw new Error("Order not found");
  }

  const detail: CustomerOrderDetail = {
    id: order.id,
    order_number: order.order_number,
    status: order.status,
    fulfillment_type: order.fulfillment_type,
    total_amount: order.total_amount,
    currency: order.currency,
    line_count: (order.order_lines || []).length,
    created_at: order.created_at,
    updated_at: order.updated_at,
    order_lines: (order.order_lines || []).map((line: any) => ({
      id: line.id,
      card_name: line.card_printings?.[0]?.cards?.name || "Unknown",
      set_name: line.card_printings?.[0]?.sets?.name || "Unknown",
      quantity: line.quantity,
      unit_price: line.unit_price,
    })),
  };

  if (order.shipments && order.shipments.length > 0) {
    detail.shipment = {
      carrier: order.shipments[0].carrier,
      tracking_number: order.shipments[0].tracking_number,
      status: order.shipments[0].status,
      estimated_delivery: order.shipments[0].estimated_delivery_date,
    };
  }

  if (order.order_handovers && order.order_handovers.length > 0) {
    detail.handover = {
      handed_over_at: order.order_handovers[0].handed_over_at,
      notes: order.order_handovers[0].notes,
    };
  }

  return detail;
}
