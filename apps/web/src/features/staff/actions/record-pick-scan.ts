"use server";

import { revalidatePath } from "next/cache";

import { createServerSupabaseClient } from "@/server/supabase";
import { logger, getRequestId } from "@/lib/logger";

export type PickActionResult = { success: true } | { success: false; error: string };

// Begins a pending batch (backlog B-142) -- transitions it to in_progress
// and, per 20260726060000_wire_up_picking_packing_shipment_workflow.sql,
// moves every order the batch covers from 'paid' to 'picking'. Called once,
// automatically, the first time a staff member opens a pending batch's
// detail page (see apps/web/src/app/staff/picking/[id]/page.tsx) -- there
// is no separate "Start" button, opening the batch to work it is the start.
export async function beginPickBatch(batchId: string): Promise<PickActionResult> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("begin_pick_batch", { p_batch_id: batchId });

  if (error) {
    logger.error("Begin pick batch failed", {
      requestId: await getRequestId(),
      batchId,
      error: logger.serializeError(error),
    });
    return { success: false, error: error.message };
  }

  return { success: true };
}

// Records one physical scan against a pick line via the atomic
// record_pick_line_scan() database function -- never manual arithmetic on
// quantity_picked in a component, per AGENTS.md rule 2. Once a line's full
// quantity has been scanned, that same database call converts its
// allocation into removed-from-stock (begin_inventory_pick() +
// complete_inventory_pick()), so this is the one real point where a "picked"
// item actually leaves inventory_allocations' picking bucket.
export async function recordPickLineScan(
  pickLineId: string,
  conditionConfirmed: "match" | "degraded" = "match",
): Promise<PickActionResult> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("record_pick_line_scan", {
    p_pick_line_id: pickLineId,
    p_condition_confirmed: conditionConfirmed,
  });

  if (error) {
    logger.error("Record pick line scan failed", {
      requestId: await getRequestId(),
      pickLineId,
      error: logger.serializeError(error),
    });
    return { success: false, error: error.message };
  }

  return { success: true };
}

// Completes a batch once every line has been fully picked --
// complete_pick_batch() itself refuses this if any line remains unpicked,
// so this action's only job is surfacing that refusal as a readable error.
export async function completePickBatch(batchId: string): Promise<PickActionResult> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("complete_pick_batch", { p_batch_id: batchId });

  if (error) {
    logger.error("Complete pick batch failed", {
      requestId: await getRequestId(),
      batchId,
      error: logger.serializeError(error),
    });
    return { success: false, error: error.message };
  }

  revalidatePath("/staff/picking");
  revalidatePath("/staff/packing");
  return { success: true };
}
