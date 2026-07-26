"use server";

// Staff access settings: who is on the team, what role they hold, and what
// that role can actually do (blueprint §18).
//
// Read-only. Granting or revoking staff access is a users.manage operation
// with real security weight, and is deliberately not exposed as a form here
// until it has its own audited action — showing the current state is what
// unblocks day-to-day "why can't I do X" questions.
import { createServerSupabaseClient } from "@/server/supabase";
import { getStaffContext } from "@/server/staff-context";
import { logger, getRequestId } from "@/lib/logger";

export interface RolePermissionMatrixEntry {
  roleCode: string;
  description: string;
  permissions: string[];
}

export interface TeamMember {
  id: string;
  userId: string;
  displayName: string | null;
  roleCode: string;
  scopeType: string;
  region: string | null;
  nodeName: string | null;
  active: boolean;
  isSelf: boolean;
}

export interface StaffSettings {
  roleCode: string;
  scopeType: string;
  permissions: string[];
  nodeNames: string[];
  team: TeamMember[];
  /** True when this membership can see the whole org's staff list. */
  canSeeTeam: boolean;
  roleMatrix: RolePermissionMatrixEntry[];
}

export async function fetchStaffSettings(): Promise<StaffSettings | null> {
  const staffContext = await getStaffContext();

  if (!staffContext) {
    return null;
  }

  const supabase = await createServerSupabaseClient();

  const [
    { data: nodes },
    { data: memberships, error: membershipsError },
    { data: roles },
    { data: rolePermissions },
  ] = await Promise.all([
    supabase.from("fulfilment_nodes").select("name").in("id", staffContext.nodeIds).order("code"),
    // staff_memberships_select returns the whole org's list only to
    // all_stores/organisation-scoped staff; everyone else sees just their
    // own row. Either way this query is safe to run -- RLS decides how much
    // comes back, and the count tells us which case we are in.
    supabase
      .from("staff_memberships")
      .select("id, user_id, role_code, scope_type, region, active, node:fulfilment_nodes(name)")
      .eq("organisation_id", staffContext.organisationId)
      .order("role_code"),
    supabase.from("roles").select("code, description").order("code"),
    supabase.from("role_permissions").select("role_code, permission_code"),
  ]);

  if (membershipsError) {
    logger.error("Fetch staff settings failed", {
      requestId: await getRequestId(),
      error: logger.serializeError(membershipsError),
    });
    throw new Error("Failed to load staff settings");
  }

  interface MembershipRow {
    id: string;
    user_id: string;
    role_code: string;
    scope_type: string;
    region: string | null;
    active: boolean;
    node: { name: string } | null;
  }

  const membershipRows = (memberships ?? []) as unknown as MembershipRow[];

  // Display names come from profiles, which staff can only read with
  // users.view (20260725170000). Without it the team list still renders,
  // just without names -- better than failing the whole page.
  const nameByUserId = new Map<string, string | null>();
  if (staffContext.permissions.includes("users.view") && membershipRows.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in(
        "id",
        membershipRows.map((row) => row.user_id),
      );

    for (const profile of profiles ?? []) {
      nameByUserId.set(profile.id, profile.display_name);
    }
  }

  const permissionsByRole = new Map<string, string[]>();
  for (const entry of rolePermissions ?? []) {
    const current = permissionsByRole.get(entry.role_code) ?? [];
    current.push(entry.permission_code);
    permissionsByRole.set(entry.role_code, current);
  }

  return {
    roleCode: staffContext.roleCode,
    scopeType: staffContext.scopeType,
    permissions: [...staffContext.permissions].sort(),
    nodeNames: (nodes ?? []).map((node) => node.name as string),
    canSeeTeam: membershipRows.length > 1,
    team: membershipRows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      displayName: nameByUserId.get(row.user_id) ?? null,
      roleCode: row.role_code,
      scopeType: row.scope_type,
      region: row.region,
      nodeName: row.node?.name ?? null,
      active: row.active,
      isSelf: row.user_id === staffContext.userId,
    })),
    roleMatrix: (roles ?? [])
      .map((role) => ({
        roleCode: role.code as string,
        description: role.description as string,
        permissions: (permissionsByRole.get(role.code as string) ?? []).sort(),
      }))
      // 'customer' is an account role, not a staff role, and holds no
      // permissions -- listing it in a staff access matrix is just noise.
      .filter((entry) => entry.permissions.length > 0),
  };
}
