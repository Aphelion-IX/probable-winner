revoke execute on function staff_has_node_access(uuid) from public, anon;
revoke execute on function staff_has_org_access(uuid) from public, anon;
grant execute on function staff_has_node_access(uuid) to authenticated;
grant execute on function staff_has_org_access(uuid) to authenticated;
