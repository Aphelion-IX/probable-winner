-- Performance advisor cleanup: 20 RLS policies called auth.uid() directly,
-- which Postgres re-evaluates once per row instead of once per query.
-- Wrapping it as `(select auth.uid())` lets the planner treat it as a
-- stable subplan evaluated once (see
-- https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select).
-- staff_has_node_access()/staff_has_org_access() calls are left as-is --
-- the advisor doesn't flag those wrapper functions, only bare auth.<fn>()
-- calls in the policy expression itself.
--
-- Also consolidates orders_select_customer/orders_select_staff and
-- order_handovers_select_customer/order_handovers_select_staff (each a pair
-- of permissive SELECT policies for the same role/table, which Postgres
-- evaluates and ORs together per row -- functionally fine but redundant)
-- into one policy per table.

alter policy addresses_select on addresses
  using (organisation_id in (
    select staff_memberships.organisation_id from staff_memberships
    where staff_memberships.user_id = (select auth.uid()) and staff_memberships.active
  ));

alter policy cart_lines_select_own on cart_lines
  using (exists (
    select 1 from carts c where c.id = cart_lines.cart_id and c.customer_id = (select auth.uid())
  ));

alter policy carts_select_own on carts
  using (customer_id = (select auth.uid()));

alter policy order_allocations_select on order_allocations
  using (exists (
    select 1 from orders o
    where o.id = order_allocations.order_id
      and (o.customer_id = (select auth.uid()) or staff_has_node_access(o.fulfilment_node_id))
  ));

alter policy order_lines_select on order_lines
  using (exists (
    select 1 from orders o
    where o.id = order_lines.order_id
      and (o.customer_id = (select auth.uid()) or staff_has_node_access(o.fulfilment_node_id))
  ));

alter policy pick_exceptions_select on pick_exceptions
  using (organisation_id in (
    select staff_memberships.organisation_id from staff_memberships
    where staff_memberships.user_id = (select auth.uid())
  ));

alter policy pick_exceptions_insert on pick_exceptions
  with check (organisation_id in (
    select staff_memberships.organisation_id from staff_memberships
    where staff_memberships.user_id = (select auth.uid())
  ));

alter policy pick_exceptions_update on pick_exceptions
  using (organisation_id in (
    select staff_memberships.organisation_id from staff_memberships
    where staff_memberships.user_id = (select auth.uid())
  ));

alter policy price_alerts_select on price_alerts
  using (customer_id = (select auth.uid()));

alter policy price_alerts_insert on price_alerts
  with check (customer_id = (select auth.uid()));

alter policy price_alerts_delete on price_alerts
  using (customer_id = (select auth.uid()));

alter policy restock_alerts_select on restock_alerts
  using (customer_id = (select auth.uid()));

alter policy restock_alerts_insert on restock_alerts
  with check (customer_id = (select auth.uid()));

alter policy restock_alerts_delete on restock_alerts
  using (customer_id = (select auth.uid()));

alter policy shipments_select on shipments
  using (exists (
    select 1 from orders o
    where o.id = shipments.order_id
      and (o.customer_id = (select auth.uid()) or staff_has_node_access(o.fulfilment_node_id))
  ));

alter policy staff_membership_nodes_select on staff_membership_nodes
  using (
    exists (
      select 1 from staff_memberships m
      where m.id = staff_membership_nodes.membership_id and m.user_id = (select auth.uid())
    )
    or exists (
      select 1 from staff_memberships m
      join staff_memberships admin_m on admin_m.organisation_id = m.organisation_id
      where m.id = staff_membership_nodes.membership_id
        and admin_m.user_id = (select auth.uid())
        and admin_m.active
        and admin_m.scope_type = any (array['all_stores', 'organisation'])
    )
  );

alter policy staff_memberships_select on staff_memberships
  using (
    user_id = (select auth.uid())
    or (
      staff_has_org_access(organisation_id)
      and exists (
        select 1 from staff_memberships admin_m
        where admin_m.user_id = (select auth.uid())
          and admin_m.active
          and admin_m.organisation_id = staff_memberships.organisation_id
          and admin_m.scope_type = any (array['all_stores', 'organisation'])
      )
    )
  );

alter policy stripe_events_select on stripe_events
  using (exists (
    select 1 from organisations o
    join staff_memberships sm on sm.organisation_id = o.id
    where sm.user_id = (select auth.uid()) and sm.active
  ));

drop policy orders_select_customer on orders;
drop policy orders_select_staff on orders;
create policy orders_select on orders
  for select to authenticated
  using (customer_id = (select auth.uid()) or staff_has_node_access(fulfilment_node_id));

drop policy order_handovers_select_customer on order_handovers;
drop policy order_handovers_select_staff on order_handovers;
create policy order_handovers_select on order_handovers
  for select to authenticated
  using (
    exists (
      select 1 from orders o
      where o.id = order_handovers.order_id and o.customer_id = (select auth.uid())
    )
    or staff_has_node_access(order_handovers.fulfilment_node_id)
  );
