-- Regression tests for the parameter-shadowing exposure fixed in
-- 20260725210000_fix_order_function_parameter_shadowing.sql.
--
-- get_order_allocations(order_id uuid) compared the order_lines column to
-- itself (`ol.order_id = order_id` resolves both sides to the column), so as
-- a SECURITY DEFINER function granted to anon it returned every order line
-- in the database for any uuid. customer_has_orders() had the same defect.
--
-- These tests pin the two properties that were broken: the parameter is
-- honoured (a uuid matching nothing returns nothing), and the functions run
-- as the invoker so RLS scopes them.
--
-- Run via `supabase test db`. Verified directly against the remote project
-- wrapped in BEGIN/ROLLBACK so no fixture data was left behind.
begin;

select plan(7);

-- Fixtures: one order with two lines, owned by a customer who is not the
-- caller in the anon tests below.
insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'shadow-owner@test.local');

insert into organisations (id, name)
values ('00000000-0000-0000-0000-0000000000d1', 'Shadow Test Org');

insert into fulfilment_nodes (id, organisation_id, name, code, type)
values ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1',
        'Shadow Store', 'SHD', 'store');

insert into orders (id, organisation_id, customer_id, fulfilment_node_id, order_number,
                    status, fulfilment_type, total_amount, currency)
values ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000d1',
        '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000d2',
        'ORD-SHADOW-1', 'pending', 'online_shipping', 20.00, 'AUD');

insert into order_lines (order_id, sellable_sku_id, quantity, unit_price, line_total)
select '00000000-0000-0000-0000-0000000000d3', id, 1, 10.00, 10.00
from sellable_skus limit 2;

-- 1-2. The signature carries the p_ prefix that makes a collision impossible.
select has_function('public', 'get_order_allocations', array['uuid'],
  'get_order_allocations(uuid) exists');
select is(
  (select pg_get_function_arguments(p.oid)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_order_allocations'),
  'p_order_id uuid',
  'get_order_allocations parameter is p_-prefixed, so it cannot be shadowed by order_lines.order_id');

-- 3-4. Neither function bypasses RLS any more.
select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_order_allocations'),
  false,
  'get_order_allocations is SECURITY INVOKER, so RLS applies');
select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'customer_has_orders'),
  false,
  'customer_has_orders is SECURITY INVOKER, so RLS applies');

-- 5. The bug itself: a uuid matching no order must return nothing. Before the
--    fix this returned every order_lines row in the database. Cast to jsonb
--    for the comparison -- plain json has no equality operator, so is()'s
--    internal `IS DISTINCT FROM` would otherwise error outright.
select is(
  get_order_allocations('00000000-0000-0000-0000-0000000000ff'::uuid)::jsonb,
  null,
  'get_order_allocations returns nothing for a uuid that matches no order');

-- 6. And the parameter is actually honoured for a real order.
select is(
  json_array_length(get_order_allocations('00000000-0000-0000-0000-0000000000d3'::uuid)::json),
  2,
  'get_order_allocations returns exactly the requested order''s lines');

-- 7. customer_has_orders must not report true for an unrelated customer.
select is(
  customer_has_orders('00000000-0000-0000-0000-0000000000fe'::uuid),
  false,
  'customer_has_orders is false for a customer with no orders');

select * from finish();

rollback;
