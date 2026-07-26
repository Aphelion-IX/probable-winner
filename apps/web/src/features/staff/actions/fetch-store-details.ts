"use server";

// Store / fulfilment-node overview (backlog Step 4's data, surfaced for
// staff). Read-only: node capability flags feed the routing algorithm
// (packages/routing), so changing them is a deliberate stores.manage
// operation rather than something to expose as an incidental toggle here.
import { createServerSupabaseClient } from "@/server/supabase";
import { getStaffContext } from "@/server/staff-context";
import { logger, getRequestId } from "@/lib/logger";

export interface StoreHours {
  dayOfWeek: number;
  opensAt: string | null;
  closesAt: string | null;
  closed: boolean;
}

export interface StoreAddress {
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postalCode: string | null;
  country: string;
}

export interface StoreDetail {
  id: string;
  name: string;
  code: string;
  type: string;
  region: string | null;
  timezone: string;
  active: boolean;
  allowsClickCollect: boolean;
  allowsOnlineFulfilment: boolean;
  allowsTransfers: boolean;
  dispatchCutoff: string | null;
  address: StoreAddress | null;
  hours: StoreHours[];
  storageLocationCount: number;
  /** Distinct SKUs with stock on hand at this node. */
  skusInStock: number;
}

export async function fetchStoreDetails(): Promise<StoreDetail[]> {
  const staffContext = await getStaffContext();

  if (!staffContext || staffContext.nodeIds.length === 0) {
    return [];
  }

  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("fulfilment_nodes")
    .select(
      `
      id,
      name,
      code,
      type,
      region,
      timezone,
      active,
      allows_click_collect,
      allows_online_fulfilment,
      allows_transfers,
      dispatch_cutoff,
      store_addresses(line1, line2, city, region, postal_code, country),
      store_hours(day_of_week, opens_at, closes_at, closed),
      storage_locations(id)
    `,
    )
    .in("id", staffContext.nodeIds)
    .order("code");

  if (error) {
    logger.error("Fetch store details failed", {
      requestId: await getRequestId(),
      error: logger.serializeError(error),
    });
    throw new Error("Failed to load stores");
  }

  // Counted separately rather than embedded: inventory_balances rows are
  // per (node, sku), so embedding them would pull one row per SKU per store
  // just to length-check the array.
  const { data: balances } = await supabase
    .from("inventory_balances")
    .select("fulfilment_node_id")
    .in("fulfilment_node_id", staffContext.nodeIds)
    .gt("quantity_on_hand", 0);

  const stockByNode = new Map<string, number>();
  for (const balance of balances ?? []) {
    stockByNode.set(
      balance.fulfilment_node_id,
      (stockByNode.get(balance.fulfilment_node_id) ?? 0) + 1,
    );
  }

  interface NodeQueryRow {
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
    store_addresses:
      | {
          line1: string;
          line2: string | null;
          city: string;
          region: string | null;
          postal_code: string | null;
          country: string;
        }[]
      | null;
    store_hours:
      | {
          day_of_week: number;
          opens_at: string | null;
          closes_at: string | null;
          closed: boolean;
        }[]
      | null;
    storage_locations: { id: string }[] | null;
  }

  return ((data ?? []) as unknown as NodeQueryRow[]).map((node) => {
    const address = node.store_addresses?.[0] ?? null;

    return {
      id: node.id,
      name: node.name,
      code: node.code,
      type: node.type,
      region: node.region,
      timezone: node.timezone,
      active: node.active,
      allowsClickCollect: node.allows_click_collect,
      allowsOnlineFulfilment: node.allows_online_fulfilment,
      allowsTransfers: node.allows_transfers,
      dispatchCutoff: node.dispatch_cutoff,
      address: address
        ? {
            line1: address.line1,
            line2: address.line2,
            city: address.city,
            region: address.region,
            postalCode: address.postal_code,
            country: address.country,
          }
        : null,
      hours: (node.store_hours ?? [])
        .map((hour) => ({
          dayOfWeek: hour.day_of_week,
          opensAt: hour.opens_at,
          closesAt: hour.closes_at,
          closed: hour.closed,
        }))
        .sort((a, b) => a.dayOfWeek - b.dayOfWeek),
      storageLocationCount: node.storage_locations?.length ?? 0,
      skusInStock: stockByNode.get(node.id) ?? 0,
    };
  });
}
