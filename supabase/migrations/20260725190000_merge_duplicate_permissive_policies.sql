-- Collapses four pairs of overlapping permissive SELECT policies into one
-- policy each (Supabase performance advisor: multiple_permissive_policies).
--
-- Each of these tables grew a narrow public policy alongside its original
-- staff policy, so the storefront could read what a customer is allowed to
-- see without loosening the staff one (fulfilment_nodes/store_addresses in
-- 20260724180000 + 20260724240000, published_prices in 20260724170000,
-- inventory_balances in 20260725120000). That was the right call for
-- correctness, but it left `authenticated` with two permissive policies per
-- table.
--
-- Postgres evaluates *every* permissive policy for a role and ORs the
-- results -- it does not stop at the first one that passes. So each row
-- scanned by a signed-in user ran the expensive staff predicate
-- (staff_has_node_access / staff_has_org_access, each an EXISTS over
-- staff_memberships) even when the cheap public predicate had already
-- allowed the row. On inventory_balances that is 1.2M rows' worth of
-- redundant subquery in the worst case.
--
-- Merging into a single policy with an explicit OR lets the planner
-- short-circuit: the cheap predicate is written first, and the staff
-- function is only reached for rows it did not already allow.
--
-- Behaviour is unchanged, for both roles:
--   * anon  -- previously matched only the public policy. staff_has_*() is
--     an EXISTS over staff_memberships filtered by auth.uid(), which is
--     null for anon, so the added OR branch is always false. Net: the same
--     public predicate as before.
--   * authenticated -- previously `staff OR public`, now literally that,
--     just as one policy instead of two.
--
-- The merged policies are granted to `anon, authenticated` (the union of
-- the two originals' roles) so neither role loses access it had.

-- fulfilment_nodes: public sees active nodes; staff see nodes in scope
-- (including inactive ones, which is why the staff branch is still needed).
drop policy if exists fulfilment_nodes_select on fulfilment_nodes;
drop policy if exists fulfilment_nodes_select_public on fulfilment_nodes;

create policy fulfilment_nodes_select on fulfilment_nodes
  for select to anon, authenticated
  using (active = true or staff_has_node_access(id));

-- store_addresses: address of any active node is public (needed for the
-- click-and-collect store picker); staff additionally see their own nodes'.
drop policy if exists store_addresses_select on store_addresses;
drop policy if exists store_addresses_select_public on store_addresses;

create policy store_addresses_select on store_addresses
  for select to anon, authenticated
  using (
    exists (
      select 1 from fulfilment_nodes fn
      where fn.id = store_addresses.fulfilment_node_id
        and fn.active = true
    )
    or staff_has_node_access(fulfilment_node_id)
  );

-- published_prices: active prices are public (the storefront shows them);
-- staff see every price in their organisation, including superseded ones.
drop policy if exists published_prices_select on published_prices;
drop policy if exists published_prices_select_public on published_prices;

create policy published_prices_select on published_prices
  for select to anon, authenticated
  using (status = 'active' or staff_has_org_access(organisation_id));

-- inventory_balances: availability at any active node is public (product
-- pages show in/out of stock); staff see balances at nodes in their scope.
drop policy if exists inventory_balances_select on inventory_balances;
drop policy if exists inventory_balances_select_public on inventory_balances;

create policy inventory_balances_select on inventory_balances
  for select to anon, authenticated
  using (
    exists (
      select 1 from fulfilment_nodes fn
      where fn.id = inventory_balances.fulfilment_node_id
        and fn.active = true
    )
    or staff_has_node_access(fulfilment_node_id)
  );
