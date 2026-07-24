-- The storefront's product page needs to show a customer whether a SKU is
-- in stock (blueprint B-103 "live availability fetch") -- backed by
-- get_sku_live_data()'s query against inventory_balances via the anon-key
-- client (apps/web/src/server/supabase.ts never attaches a customer's own
-- session, by design: it's the anon/publishable key, safe to hold
-- server-side or client-side, with RLS enforcing access control).
--
-- inventory_balances only ever got a staff-scoped policy
-- (20260723054635_inventory_rls.sql: `for select to authenticated using
-- (staff_has_node_access(...))`), which even a logged-in customer fails
-- (they're not staff). The result: availableQuantity always sums to 0 for
-- every anon/customer request, regardless of real stock, and the product
-- page shows "Out of stock" unconditionally -- add-to-cart never works.
--
-- Same shape as fulfilment_nodes_select_public/store_addresses_select_public
-- (20260724180000_customer_profiles_and_addresses.sql,
-- 20260724240000_store_addresses_public_read.sql): add a narrower public
-- policy rather than loosen the staff one, per AGENTS.md rule 4, scoped to
-- active stores only (matching what a customer can otherwise see/select).
create policy inventory_balances_select_public on inventory_balances
  for select to anon, authenticated
  using (
    exists (
      select 1 from fulfilment_nodes fn
      where fn.id = inventory_balances.fulfilment_node_id
        and fn.active = true
    )
  );
