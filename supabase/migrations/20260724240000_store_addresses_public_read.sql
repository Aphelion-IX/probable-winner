-- Click-and-collect store selection at checkout (backlog Step 13/B-121)
-- needs to show a customer each eligible store's address, but
-- store_addresses only has the staff-scoped policy from
-- 20260722082907_rls_policies_org_store_scope.sql (staff_has_node_access).
-- Same shape as fulfilment_nodes_select_public
-- (20260724180000_customer_profiles_and_addresses.sql): add a narrower
-- public policy rather than loosening the staff one, per AGENTS.md rule 4,
-- scoped to active stores only.
create policy store_addresses_select_public on store_addresses
  for select to anon, authenticated
  using (
    exists (
      select 1 from fulfilment_nodes fn
      where fn.id = store_addresses.fulfilment_node_id
        and fn.active = true
    )
  );
