-- Fixes a confirmed anonymous data exposure in get_order_allocations(), the
-- same latent bug in customer_has_orders(), and tightens EXECUTE grants on
-- functions that should never be callable over the Data API.
--
-- THE BUG
--
-- 20260724080000_order_allocations_schema.sql declared:
--
--   create function get_order_allocations(order_id uuid) ...
--     from order_lines ol where ol.order_id = order_id;
--
-- Both sides of that predicate resolve to the *column*, not the parameter,
-- so it reads `ol.order_id = ol.order_id` -- true for every row. Combined
-- with SECURITY DEFINER (which bypasses RLS) and an EXECUTE grant to `anon`,
-- an unauthenticated caller could POST any uuid to
-- /rest/v1/rpc/get_order_allocations and receive the sku ids, quantities,
-- fulfilment nodes and routing reasons for EVERY order line in the database.
-- Verified against the live database: a uuid matching no order returned all
-- 325,305 order_lines rows.
--
-- customer_has_orders() (20260723081706) has the identical defect --
-- `where customer_id = customer_id` -- and returns true for any uuid
-- whenever any order exists. Lower impact (a boolean), same root cause.
--
-- WHY IT SURVIVED REVIEW
--
-- Its sibling verify_order_allocation_complete() was written with a p_
-- prefix, and the original migration explains why: that function is
-- plpgsql, where an ambiguous reference raises under the default
-- variable_conflict = error. get_order_allocations() and
-- customer_has_orders() are LANGUAGE SQL, which has no such guard -- the
-- column silently wins. The safety net that caught the collision in one
-- function simply does not exist in the other two.
--
-- THE FIX
--
-- Parameters are renamed with a p_ prefix so a collision is impossible, and
-- all three functions become SECURITY INVOKER. They only read orders,
-- order_lines and order_allocations, each of which already carries a correct
-- SELECT policy ("the owning customer, or staff with access to the order's
-- node"). Running as the invoker means RLS supplies exactly that, rather
-- than the function bypassing RLS and then re-implementing authorisation by
-- hand -- which is what created the hole. anon now gets nothing, customers
-- get their own orders, staff get their scope, with no bespoke check to keep
-- in sync.
--
-- DROP + CREATE rather than CREATE OR REPLACE: Postgres refuses to rename an
-- input parameter in place ("cannot change name of input parameter").
-- Nothing references either function -- no policy, view, trigger, or
-- application call site (verified by grep across apps/ and packages/).

drop function if exists get_order_allocations(uuid);

create function get_order_allocations(p_order_id uuid)
returns json
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_agg(
    jsonb_build_object(
      'sku_id', ol.sellable_sku_id,
      'quantity', ol.quantity,
      'allocated_nodes', (
        select jsonb_agg(
          jsonb_build_object(
            'node_id', oa.allocated_to_node_id,
            'quantity', oa.quantity,
            'reason', oa.routing_reason
          )
        )
        from order_allocations oa
        where oa.order_line_id = ol.id
      )
    )
  )
  from order_lines ol
  where ol.order_id = p_order_id;
$$;

drop function if exists customer_has_orders(uuid);

create function customer_has_orders(p_customer_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (select 1 from orders where customer_id = p_customer_id);
$$;

-- Already correctly parameterised; switched to SECURITY INVOKER for the same
-- reason as the two above -- it returned line counts for any order id to any
-- caller, which RLS now scopes for it.
create or replace function verify_order_allocation_complete(p_order_id uuid)
returns json
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_total_lines integer;
  v_allocated_lines integer;
begin
  select count(*) into v_total_lines
  from order_lines where order_id = p_order_id;

  select count(distinct order_line_id) into v_allocated_lines
  from order_allocations where order_id = p_order_id;

  return jsonb_build_object(
    'complete', v_total_lines = v_allocated_lines and v_total_lines > 0,
    'total_lines', v_total_lines,
    'allocated_lines', v_allocated_lines
  );
end;
$$;

-- Trigger and event-trigger functions: never meant to be called directly,
-- but both were reachable as SECURITY DEFINER RPCs over the Data API.
-- Revoking EXECUTE does not affect trigger firing -- Postgres checks EXECUTE
-- when the trigger is created, not each time it fires.
revoke execute on function handle_new_customer() from public, anon, authenticated;
revoke execute on function enqueue_stock_reconciliation() from public, anon, authenticated;

-- rls_auto_enable() has no CREATE FUNCTION anywhere in this migration
-- history -- it exists only on the live project (created directly against
-- it, outside any migration, likely via a Studio "Security Advisor" quick
-- fix), so this bare `revoke` succeeded there but raised
-- "function rls_auto_enable() does not exist" (42883) on every genuinely
-- fresh database -- exactly what CI's new `supabase start`/`db reset` do
-- (2026-07-26 security re-audit item 10), aborting the whole migration
-- chain before a single pgTAP test could run. Guarded so a fresh reset
-- simply has nothing to revoke; a no-op against the live project either
-- way, since DDL there already ran once and won't re-run.
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable' and p.pronargs = 0
  ) then
    revoke execute on function rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;

-- staff_has_permission() is an RLS helper and belongs with its siblings.
-- 20260722082938 locked down staff_has_node_access/staff_has_org_access this
-- way; staff_has_permission was added later (20260723082300) and missed the
-- same treatment, leaving it anon-executable. It stays executable by
-- `authenticated` because RLS policies calling it are evaluated as the
-- invoking role.
revoke execute on function staff_has_permission(text) from public, anon;
grant execute on function staff_has_permission(text) to authenticated;
