import { createServerSupabaseClient } from "./supabase";

export interface StaffContext {
  userId: string;
  nodeId: string;
  nodeIds: string[];
  scopeType: string;
}

export async function getStaffContext(): Promise<StaffContext | null> {
  const supabase = createServerSupabaseClient();

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  // Get staff membership
  const { data: membership, error } = await supabase
    .from("staff_memberships")
    .select("id, fulfilment_node_id, scope_type")
    .eq("user_id", user.id)
    .eq("active", true)
    .single();

  if (error || !membership) {
    return null;
  }

  const nodeIds: string[] = [];
  let primaryNodeId = "";

  if (membership.fulfilment_node_id) {
    // Direct node assignment (scope_type = 'store')
    primaryNodeId = membership.fulfilment_node_id;
    nodeIds.push(membership.fulfilment_node_id);
  } else {
    // Multiple nodes via staff_membership_nodes
    const { data: nodes } = await supabase
      .from("staff_membership_nodes")
      .select("fulfilment_node_id")
      .eq("membership_id", membership.id);

    if (nodes && nodes.length > 0) {
      nodes.forEach((n) => nodeIds.push(n.fulfilment_node_id));
      primaryNodeId = nodes[0].fulfilment_node_id;
    }
  }

  return {
    userId: user.id,
    nodeId: primaryNodeId,
    nodeIds,
    scopeType: membership.scope_type,
  };
}
