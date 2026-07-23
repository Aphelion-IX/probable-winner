-- receive_inventory() and adjust_inventory() (blueprint §9.3, backlog
-- B-061). These are the first two of the atomic stock operations; each
-- must, inside one transaction: (1) lock the affected balance row,
-- (2) validate input, (3) write a movement, (4) update the balance,
-- (5) commit. Step "write an integration event" from §9.3 is deliberately
-- NOT done here -- backlog B-082 adds outbox writes to every atomic
-- function (B-061-B-071, B-160s) together, once all of them exist, rather
-- than retrofitting each one individually as it lands.
--
-- quantity_available_online is kept equal to the same delta as
-- quantity_on_hand in both functions below. That's only correct because no
-- atomic function yet exists that moves stock into quantity_reserved/
-- quantity_allocated/quantity_quarantined/quantity_safety_stock (those
-- start, and stay, at 0 until B-062/B-063/B-064 land) -- once those exist,
-- and once docs/inventory-rules.md (backlog B-002, not yet written) codifies
-- the exact availability formula, this simplification must be revisited.

-- Shared row-lock step for every atomic inventory function (§9.3 step 1):
-- ensures a balance row exists for (node, sku), then locks it. A relative
-- UPDATE later in each caller (quantity_x = quantity_x + delta) combined
-- with this lock is what makes concurrent calls for the same (node, sku)
-- safe: Postgres serializes concurrent UPDATEs of the same row, so the
-- second caller blocks until the first transaction commits or rolls back,
-- then operates on the post-commit value -- no lost update is possible.
-- Not exposed to authenticated/anon (see the revoke below): callers must go
-- through one of the public atomic functions, which perform their own
-- authorization check first.
create or replace function lock_inventory_balance(
  p_fulfilment_node_id uuid,
  p_sellable_sku_id uuid
) returns inventory_balances
language plpgsql
set search_path = public
as $$
declare
  v_balance inventory_balances;
begin
  insert into inventory_balances (fulfilment_node_id, sellable_sku_id)
  values (p_fulfilment_node_id, p_sellable_sku_id)
  on conflict (fulfilment_node_id, sellable_sku_id) do nothing;

  select * into v_balance
  from inventory_balances
  where fulfilment_node_id = p_fulfilment_node_id and sellable_sku_id = p_sellable_sku_id
  for update;

  return v_balance;
end;
$$;

revoke execute on function lock_inventory_balance(uuid, uuid) from public, anon, authenticated;

create or replace function receive_inventory(
  p_fulfilment_node_id uuid,
  p_sellable_sku_id uuid,
  p_quantity integer,
  p_reference_type text default null,
  p_reference_id uuid default null,
  p_reason text default null
) returns inventory_movements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_organisation_id uuid;
  v_movement inventory_movements;
begin
  if p_quantity <= 0 then
    raise exception 'receive_inventory: quantity must be positive, got %', p_quantity;
  end if;

  if not staff_has_node_access(p_fulfilment_node_id) then
    raise exception 'receive_inventory: access denied for fulfilment node %', p_fulfilment_node_id
      using errcode = '42501';
  end if;

  select organisation_id into v_organisation_id
  from fulfilment_nodes where id = p_fulfilment_node_id;

  if v_organisation_id is null then
    raise exception 'receive_inventory: unknown fulfilment node %', p_fulfilment_node_id;
  end if;

  perform lock_inventory_balance(p_fulfilment_node_id, p_sellable_sku_id);

  insert into inventory_movements (
    organisation_id, fulfilment_node_id, sellable_sku_id, movement_type,
    quantity_delta, reference_type, reference_id, staff_user_id, reason
  ) values (
    v_organisation_id, p_fulfilment_node_id, p_sellable_sku_id, 'receive',
    p_quantity, p_reference_type, p_reference_id, auth.uid(), p_reason
  )
  returning * into v_movement;

  update inventory_balances
  set quantity_on_hand = quantity_on_hand + p_quantity,
      quantity_available_online = quantity_available_online + p_quantity,
      updated_at = now()
  where fulfilment_node_id = p_fulfilment_node_id and sellable_sku_id = p_sellable_sku_id;

  return v_movement;
end;
$$;

revoke execute on function receive_inventory(uuid, uuid, integer, text, uuid, text) from public, anon;
grant execute on function receive_inventory(uuid, uuid, integer, text, uuid, text) to authenticated;

-- General-purpose manual correction, restricted to the movement types that
-- are genuinely simple on-hand deltas. Everything else in the §9.2 list has
-- (or will have) its own dedicated atomic function: reserve/
-- release_reservation (B-062), allocate/begin_picking/complete_picking
-- (B-063), transfer_out/transfer_in (B-071), receive (above), sale (checkout/
-- payment flow, B-125), and quarantine (B-064 -- moving stock into the
-- quarantined bucket is a transfer between balance columns, not a plain
-- on-hand delta, so it needs its own logic, not this function).
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

  if not staff_has_node_access(p_fulfilment_node_id) then
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

revoke execute on function adjust_inventory(uuid, uuid, text, integer, text, text, uuid) from public, anon;
grant execute on function adjust_inventory(uuid, uuid, text, integer, text, text, uuid) to authenticated;
