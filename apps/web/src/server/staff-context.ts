import { createServerSupabaseClient } from "./supabase";

export interface StaffContext {
  userId: string;
  organisationId: string;
  roleCode: string;
  /** Permission codes granted by this membership's role (blueprint §18). */
  permissions: string[];
  /**
   * First node in `nodeIds`, kept for callers that only need "a" node to act
   * against. Empty string when the membership resolves to no active nodes.
   */
  nodeId: string;
  /** Every active fulfilment node this membership grants access to. */
  nodeIds: string[];
  scopeType: string;
}

/**
 * Resolves the nodes a membership can act on, for every scope type.
 *
 * Previously only 'store' (direct fulfilment_node_id) and 'selected_stores'
 * (staff_membership_nodes) were resolved; 'region', 'all_stores' and
 * 'organisation' fell through to the staff_membership_nodes lookup, which
 * has no rows for those scopes, so nodeIds came back empty. Any screen that
 * scopes a query by nodeIds therefore showed nothing at all to exactly the
 * broadest-access roles. staff_has_node_access() in SQL has always handled
 * all five scope types (20260722082907); this mirrors that logic so the
 * application layer agrees with RLS.
 */
async function resolveNodeIds(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  membership: {
    id: string;
    organisation_id: string;
    scope_type: string;
    fulfilment_node_id: string | null;
    region: string | null;
  },
): Promise<string[]> {
  if (membership.scope_type === "store") {
    return membership.fulfilment_node_id ? [membership.fulfilment_node_id] : [];
  }

  if (membership.scope_type === "selected_stores") {
    const { data } = await supabase
      .from("staff_membership_nodes")
      .select("fulfilment_node_id")
      .eq("membership_id", membership.id);

    return (data ?? []).map((row) => row.fulfilment_node_id as string);
  }

  // region / all_stores / organisation: every active node in the org,
  // narrowed to the membership's region when the scope is regional.
  let query = supabase
    .from("fulfilment_nodes")
    .select("id")
    .eq("organisation_id", membership.organisation_id)
    .eq("active", true)
    .order("code");

  if (membership.scope_type === "region") {
    if (!membership.region) return [];
    query = query.eq("region", membership.region);
  }

  const { data } = await query;
  return (data ?? []).map((row) => row.id as string);
}

export async function getStaffContext(): Promise<StaffContext | null> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  // A user can legitimately hold more than one active membership (two
  // organisations, or a regional role alongside a store role), which made
  // the previous .single() error out and return null -- locking those staff
  // out of the portal entirely. Take the oldest membership as the active
  // one instead of failing.
  const { data: memberships, error } = await supabase
    .from("staff_memberships")
    .select("id, organisation_id, fulfilment_node_id, role_code, scope_type, region")
    .eq("user_id", user.id)
    .eq("active", true)
    .order("created_at")
    .limit(1);

  const membership = memberships?.[0];

  if (error || !membership) {
    return null;
  }

  const [nodeIds, { data: rolePermissions }] = await Promise.all([
    resolveNodeIds(supabase, membership),
    supabase.from("role_permissions").select("permission_code").eq("role_code", membership.role_code),
  ]);

  return {
    userId: user.id,
    organisationId: membership.organisation_id,
    roleCode: membership.role_code,
    permissions: (rolePermissions ?? []).map((row) => row.permission_code as string),
    nodeId: nodeIds[0] ?? "",
    nodeIds,
    scopeType: membership.scope_type,
  };
}
