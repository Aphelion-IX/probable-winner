"use server";

import { createServerSupabaseClient } from "@/server/supabase";
import { getStaffContext } from "@/server/staff-context";

export interface DashboardStats {
  pending_orders: number;
  active_pick_batches: number;
  pending_exceptions: number;
  ready_shipments: number;
  ready_handovers: number;
  recent_orders: Array<{
    id: string;
    order_number: string;
    status: string;
    fulfilment_type: string;
    created_at: string;
  }>;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const supabase = createServerSupabaseClient();
  const staffContext = await getStaffContext();

  if (!staffContext) {
    throw new Error("Not authenticated as staff");
  }

  // Count pending orders
  const { count: pending_orders } = await supabase
    .from("orders")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");

  // Count active pick batches
  const { count: active_pick_batches } = await supabase
    .from("pick_batches")
    .select("*", { count: "exact", head: true })
    .in("status", ["pending", "in_progress"]);

  // Count unresolved exceptions
  const { count: pending_exceptions } = await supabase
    .from("pick_exceptions")
    .select("*", { count: "exact", head: true })
    .is("resolved_at", null);

  // Count packing shipments ready to ship
  const { count: ready_shipments } = await supabase
    .from("packing_shipments")
    .select("*", { count: "exact", head: true })
    .eq("status", "labeled");

  // Count click-and-collect orders ready for handover
  const { data: handoverOrders } = await supabase.rpc("get_ready_for_handover_orders", {
    p_fulfilment_node_id: staffContext.nodeId,
  });
  const ready_handovers = handoverOrders?.length || 0;

  // Get recent orders
  const { data: recent_orders } = await supabase
    .from("orders")
    .select("id, order_number, status, fulfilment_type, created_at")
    .order("created_at", { ascending: false })
    .limit(10);

  return {
    pending_orders: pending_orders || 0,
    active_pick_batches: active_pick_batches || 0,
    pending_exceptions: pending_exceptions || 0,
    ready_shipments: ready_shipments || 0,
    ready_handovers,
    recent_orders: recent_orders || [],
  };
}
