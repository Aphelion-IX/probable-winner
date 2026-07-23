"use server";

import { createServerSupabaseClient } from "@/server/supabase";

export interface OrderForHandover {
  order_id: string;
  order_number: string;
  customer_id: string;
  total_amount: number;
  currency: string;
  status: string;
  created_at: string;
}

export interface OrderHandover {
  id: string;
  order_id: string;
  fulfilment_node_id: string;
  handed_over_at: string;
  notes: string | null;
}

export async function getReadyForHandoverOrders(nodeId: string): Promise<OrderForHandover[]> {
  const supabase = createServerSupabaseClient();

  const { data: orders, error } = await supabase.rpc("get_ready_for_handover_orders", {
    p_fulfilment_node_id: nodeId,
  });

  if (error) {
    console.error("Get handover orders error:", error);
    throw new Error("Failed to fetch orders ready for handover");
  }

  return (orders as OrderForHandover[] | null) || [];
}

export async function recordOrderHandover(
  orderId: string,
  nodeId: string,
  notes?: string
): Promise<OrderHandover> {
  const supabase = createServerSupabaseClient();

  const { data: handover, error } = await supabase.rpc("record_order_handover", {
    p_order_id: orderId,
    p_fulfilment_node_id: nodeId,
    p_notes: notes || null,
  });

  if (error) {
    console.error("Record handover error:", error);
    throw new Error(`Failed to record handover: ${error.message}`);
  }

  if (!handover) {
    throw new Error("Handover was not recorded");
  }

  return handover;
}

export async function getOrderHandover(orderId: string): Promise<OrderHandover | null> {
  const supabase = createServerSupabaseClient();

  const { data: handover, error } = await supabase
    .from("order_handovers")
    .select("id, order_id, fulfilment_node_id, handed_over_at, notes")
    .eq("order_id", orderId)
    .single();

  if (error && error.code !== "PGRST116") {
    // PGRST116 is "no rows found" which is expected if not handed over yet
    console.error("Get handover error:", error);
    throw new Error("Failed to fetch handover");
  }

  return (handover as OrderHandover | null) || null;
}
