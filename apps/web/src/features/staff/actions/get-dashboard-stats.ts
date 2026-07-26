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
  const supabase = await createServerSupabaseClient();
  const staffContext = await getStaffContext();

  if (!staffContext) {
    throw new Error("Not authenticated as staff");
  }

  // These six reads are independent of one another once staff auth is
  // confirmed above, so they run concurrently rather than one at a time.
  const [
    { count: pending_orders },
    { count: active_pick_batches },
    { count: pending_exceptions },
    { count: ready_shipments },
    { data: handoverOrders },
    { data: recent_orders },
  ] = await Promise.all([
    // Count pending orders
    supabase.from("orders").select("*", { count: "exact", head: true }).eq("status", "pending"),
    // Count active pick batches
    supabase
      .from("pick_batches")
      .select("*", { count: "exact", head: true })
      .in("status", ["pending", "in_progress"]),
    // Count unresolved exceptions
    supabase
      .from("pick_exceptions")
      .select("*", { count: "exact", head: true })
      .is("resolved_at", null),
    // Count packing shipments ready to ship
    supabase
      .from("packing_shipments")
      .select("*", { count: "exact", head: true })
      .eq("status", "labeled"),
    // Count click-and-collect orders ready for handover
    supabase.rpc("get_ready_for_handover_orders", {
      p_fulfilment_node_id: staffContext.nodeId,
    }),
    // Get recent orders
    supabase
      .from("orders")
      .select("id, order_number, status, fulfilment_type, created_at")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const ready_handovers = handoverOrders?.length || 0;

  return {
    pending_orders: pending_orders || 0,
    active_pick_batches: active_pick_batches || 0,
    pending_exceptions: pending_exceptions || 0,
    ready_shipments: ready_shipments || 0,
    ready_handovers,
    recent_orders: recent_orders || [],
  };
}
