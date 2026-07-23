-- is_trusted_backend_connection() (prerequisite for backlog B-065): the
-- worker connects directly to Postgres with a privileged connection string
-- (apps/worker/src/db.ts), not through PostgREST with a staff JWT -- so
-- auth.role() is null for that connection (verified directly against the
-- remote project), same as any other superuser/service connection. The
-- staff-gated atomic functions (receive_inventory() etc.) need a way to
-- distinguish "no JWT at all, i.e. a trusted backend process" from "a real
-- anon/authenticated caller with insufficient permissions" -- an
-- authenticated end user's JWT always carries a non-null role claim, so
-- auth.role() is null is specific to the trusted-connection case, unlike
-- auth.uid() is null (which a malformed/edge-case authenticated JWT could
-- also produce).
create or replace function is_trusted_backend_connection()
returns boolean
language sql
stable
as $$
  select auth.role() is null;
$$;

revoke execute on function is_trusted_backend_connection() from public, anon;
grant execute on function is_trusted_backend_connection() to authenticated;

-- Backlog B-065's reconciliation job runs in the worker (a trusted backend
-- connection), calling adjust_inventory() directly for each stocktake
-- variance -- so this is the one staff-gated function from B-061 that
-- needs the bypass right now. Apply the same pattern to other staff-gated
-- functions only if/when a worker job actually needs to call them
-- directly, rather than adding it everywhere speculatively.
create or replace function adjust_inventory(
  p_fulfilment_node_id uuid,
  p_sellable_sku_id uuid,
  p_movement_type text,
  p_quantity_delta integer,
  p_reason text,
  p_reference_type text default null,
  p_reference_id uuid default null
) returns inventory_movements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_organisation_id uuid;
  v_movement inventory_movements;
begin
  if p_movement_type not in ('damage', 'stocktake_adjustment', 'return', 'buylist_acquisition') then
    raise exception 'adjust_inventory: % is not a manual-adjustment movement_type -- use the dedicated atomic function for reserve/allocate/pick/transfer/receive/sale/quarantine movements', p_movement_type;
  end if;

  if p_quantity_delta = 0 then
    raise exception 'adjust_inventory: quantity_delta must be non-zero';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'adjust_inventory: a reason is required for manual adjustments';
  end if;

  if not is_trusted_backend_connection() and not staff_has_node_access(p_fulfilment_node_id) then
    raise exception 'adjust_inventory: access denied for fulfilment node %', p_fulfilment_node_id
      using errcode = '42501';
  end if;

  select organisation_id into v_organisation_id
  from fulfilment_nodes where id = p_fulfilment_node_id;

  if v_organisation_id is null then
    raise exception 'adjust_inventory: unknown fulfilment node %', p_fulfilment_node_id;
  end if;

  perform lock_inventory_balance(p_fulfilment_node_id, p_sellable_sku_id);

  insert into inventory_movements (
    organisation_id, fulfilment_node_id, sellable_sku_id, movement_type,
    quantity_delta, reference_type, reference_id, staff_user_id, reason
  ) values (
    v_organisation_id, p_fulfilment_node_id, p_sellable_sku_id, p_movement_type,
    p_quantity_delta, p_reference_type, p_reference_id, auth.uid(), p_reason
  )
  returning * into v_movement;

  -- quantity_on_hand's own check constraint (>= 0) is what rejects an
  -- adjustment that would take on-hand stock negative, e.g. recording more
  -- damage than is actually on hand.
  update inventory_balances
  set quantity_on_hand = quantity_on_hand + p_quantity_delta,
      quantity_available_online = quantity_available_online + p_quantity_delta,
      updated_at = now()
  where fulfilment_node_id = p_fulfilment_node_id and sellable_sku_id = p_sellable_sku_id;

  return v_movement;
end;
$$;
