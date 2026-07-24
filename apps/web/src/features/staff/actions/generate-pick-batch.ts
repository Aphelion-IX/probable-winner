"use server";

import { createServerSupabaseClient } from "@/server/supabase";
import { getStaffContext } from "@/server/staff-context";
import { logger, getRequestId } from "@/lib/logger";

export interface GeneratePickBatchResult {
  success: boolean;
  batchId?: string;
  error?: string;
}

// The only caller of create_pick_batch() (B-141) — without this, a paid
// order's converted allocations (confirm_order_payment) had no path to
// ever becoming a pick batch a staff member could work from the picking
// list, since nothing else in the app calls it.
export async function generatePickBatch(): Promise<GeneratePickBatchResult> {
  const staffContext = await getStaffContext();

  if (!staffContext) {
    return { success: false, error: "Not authenticated as staff" };
  }

  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase.rpc("create_pick_batch", {
    p_fulfilment_node_id: staffContext.nodeId,
  });

  if (error) {
    logger.error("Generate pick batch failed", {
      requestId: await getRequestId(),
      nodeId: staffContext.nodeId,
      error: logger.serializeError(error),
    });
    return { success: false, error: error.message };
  }

  return { success: true, batchId: data as string };
}
