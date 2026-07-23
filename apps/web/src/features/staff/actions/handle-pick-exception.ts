"use server";

import { createServerSupabaseClient } from "@/server/supabase";

export interface PickException {
  id: string;
  pick_line_id: string;
  exception_type_id: string;
  exception_type: {
    code: string;
    name: string;
  };
  severity: "info" | "warning" | "critical";
  notes: string | null;
  resolution: "substitute" | "refund" | "contact_customer" | "resolved" | null;
  resolved_at: string | null;
  created_at: string;
}

export async function recordPickException(
  pickLineId: string,
  exceptionTypeCode: string,
  notes?: string,
  severity: "info" | "warning" | "critical" = "warning"
): Promise<void> {
  const supabase = createServerSupabaseClient();

  const { error } = await supabase.rpc("record_pick_exception", {
    p_pick_line_id: pickLineId,
    p_exception_type_code: exceptionTypeCode,
    p_notes: notes || null,
    p_severity: severity,
  });

  if (error) {
    console.error("Record exception error:", error);
    throw new Error(`Failed to record exception: ${error.message}`);
  }
}

export async function resolvePickException(
  exceptionId: string,
  resolution: "substitute" | "refund" | "contact_customer" | "resolved"
): Promise<void> {
  const supabase = createServerSupabaseClient();

  const { error } = await supabase.rpc("resolve_pick_exception", {
    p_exception_id: exceptionId,
    p_resolution: resolution,
  });

  if (error) {
    console.error("Resolve exception error:", error);
    throw new Error(`Failed to resolve exception: ${error.message}`);
  }
}

interface ExceptionRow {
  id: string;
  pick_line_id: string;
  exception_type_id: string;
  exception_type: { code: string; name: string };
  severity: string;
  notes: string | null;
  resolution: string | null;
  resolved_at: string | null;
  created_at: string;
}

export async function getPickLineExceptions(pickLineId: string): Promise<PickException[]> {
  const supabase = createServerSupabaseClient();

  const { data: exceptions, error } = await supabase
    .from("pick_exceptions")
    .select(
      `
      id,
      pick_line_id,
      exception_type_id,
      exception_type:pick_exception_types(code, name),
      severity,
      notes,
      resolution,
      resolved_at,
      created_at
    `
    )
    .eq("pick_line_id", pickLineId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Get exceptions error:", error);
    throw new Error("Failed to fetch exceptions");
  }

  return (((exceptions as unknown) as ExceptionRow[] | null) || []).map((exc: ExceptionRow) => ({
    id: exc.id,
    pick_line_id: exc.pick_line_id,
    exception_type_id: exc.exception_type_id,
    exception_type: exc.exception_type,
    severity: exc.severity as "info" | "warning" | "critical",
    notes: exc.notes,
    resolution: (exc.resolution as "substitute" | "refund" | "contact_customer" | "resolved" | null) ||
      null,
    resolved_at: exc.resolved_at,
    created_at: exc.created_at,
  }));
}

export async function getUnresolvedExceptions(batchId: string): Promise<PickException[]> {
  const supabase = createServerSupabaseClient();

  const { data: exceptions, error } = await supabase
    .from("pick_exceptions")
    .select(
      `
      id,
      pick_line_id,
      exception_type_id,
      exception_type:pick_exception_types(code, name),
      severity,
      notes,
      resolution,
      resolved_at,
      created_at,
      pick_line:pick_lines(
        order_line_id,
        sort_order
      )
    `
    )
    .eq("pick_lines.pick_batch_id", batchId)
    .is("resolved_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Get unresolved exceptions error:", error);
    throw new Error("Failed to fetch unresolved exceptions");
  }

  return (((exceptions as unknown) as ExceptionRow[] | null) || []).map((exc: ExceptionRow) => ({
    id: exc.id,
    pick_line_id: exc.pick_line_id,
    exception_type_id: exc.exception_type_id,
    exception_type: exc.exception_type,
    severity: exc.severity as "info" | "warning" | "critical",
    notes: exc.notes,
    resolution: (exc.resolution as "substitute" | "refund" | "contact_customer" | "resolved" | null) ||
      null,
    resolved_at: exc.resolved_at,
    created_at: exc.created_at,
  }));
}
