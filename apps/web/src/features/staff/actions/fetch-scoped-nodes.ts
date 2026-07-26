"use server";

import { createServerSupabaseClient } from "@/server/supabase";
import { getStaffContext } from "@/server/staff-context";
import { logger, getRequestId } from "@/lib/logger";

export interface ScopedNode {
  id: string;
  name: string;
  code: string;
  type: string;
  region: string | null;
  timezone: string;
  active: boolean;
  allows_click_collect: boolean;
  allows_online_fulfilment: boolean;
  allows_transfers: boolean;
  dispatch_cutoff: string | null;
}

/**
 * The fulfilment nodes the signed-in staff member may act on, resolved from
 * their membership scope. Shared by every staff screen that needs a node
 * picker (inventory, receiving, transfers, shipping, stores).
 *
 * Returns [] rather than throwing when there is no staff session, so a
 * screen can render its own "not staff" empty state.
 */
export async function fetchScopedNodes(): Promise<ScopedNode[]> {
  const staffContext = await getStaffContext();

  if (!staffContext || staffContext.nodeIds.length === 0) {
    return [];
  }

  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("fulfilment_nodes")
    .select(
      "id, name, code, type, region, timezone, active, allows_click_collect, allows_online_fulfilment, allows_transfers, dispatch_cutoff",
    )
    .in("id", staffContext.nodeIds)
    .order("code");

  if (error) {
    logger.error("Fetch scoped nodes failed", {
      requestId: await getRequestId(),
      error: logger.serializeError(error),
    });
    throw new Error("Failed to load fulfilment nodes");
  }

  return (data ?? []) as ScopedNode[];
}
