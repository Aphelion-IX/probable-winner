-- allocate_order_inventory(), begin_inventory_pick(), complete_inventory_pick()
-- (blueprint §9.3, backlog B-063). Staff-gated like B-061's functions (not
-- B-062's) -- allocation/picking are warehouse/store fulfilment operations
-- (blueprint §15 "Staff fulfilment"), not something a customer triggers
-- directly.
--
-- Bucket flow: quantity_reserved -> quantity_allocated (allocate) ->
-- quantity_picking (begin_inventory_pick) -> physically removed from
-- quantity_on_hand (complete_inventory_pick). quantity_available_online is
-- untouched by all three: it already excluded the reserved unit before
-- allocation even starts (per B-062), and stays excluded all the way
-- through picking until the stock actually leaves quantity_on_hand.

create or replace function allocate_order_inventory(
  p_reservation_id uuid,
  p_order_line_id uuid default null
) returns inventory_allocations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reservation inventory_reservations;
  v_allocation inventory_allocations;
begin
  select * into v_reservation from inventory_reservations where id = p_reservation_id;

  if v_reservation is null then
    raise exception 'allocate_order_inventory: unknown reservation %', p_reservation_id;
  end if;

  if v_reservation.status <> 'active' then
    raise exception 'allocate_order_inventory: reservation % is %, not active -- cannot allocate', p_reservation_id, v_reservation.status;
  end if;

  if not staff_has_node_access(v_reservation.fulfilment_node_id) then
    raise exception 'allocate_order_inventory: access denied for fulfilment node %', v_reservation.fulfilment_node_id
      using errcode = '42501';
  end if;

  perform lock_inventory_balance(v_reservation.fulfilment_node_id, v_reservation.sellable_sku_id);

  update inventory_balances
  set quantity_reserved = quantity_reserved - v_reservation.quantity,
      quantity_allocated = quantity_allocated + v_reservation.quantity,
      updated_at = now()
  where fulfilment_node_id = v_reservation.fulfilment_node_id and sellable_sku_id = v_reservation.sellable_sku_id;

  update inventory_reservations
  set status = 'converted', updated_at = now()
  where id = p_reservation_id;

  insert into inventory_allocations (
    organisation_id, fulfilment_node_id, sellable_sku_id, inventory_reservation_id, order_line_id, quantity
  ) values (
    v_reservation.organisation_id, v_reservation.fulfilment_node_id, v_reservation.sellable_sku_id,
    v_reservation.id, p_order_line_id, v_reservation.quantity
  )
  returning * into v_allocation;

  insert into inventory_movements (
    organisation_id, fulfilment_node_id, sellable_sku_id, movement_type,
    quantity_delta, reference_type, reference_id, staff_user_id
  ) values (
    v_reservation.organisation_id, v_reservation.fulfilment_node_id, v_reservation.sellable_sku_id,
    'allocate', v_reservation.quantity, 'inventory_allocation', v_allocation.id, auth.uid()
  );

  return v_allocation;
end;
$$;

revoke execute on function allocate_order_inventory(uuid, uuid) from public, anon;
grant execute on function allocate_order_inventory(uuid, uuid) to authenticated;

create or replace function begin_inventory_pick(
  p_allocation_id uuid
) returns inventory_allocations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allocation inventory_allocations;
begin
  select * into v_allocation from inventory_allocations where id = p_allocation_id;

  if v_allocation is null then
    raise exception 'begin_inventory_pick: unknown allocation %', p_allocation_id;
  end if;

  if v_allocation.status <> 'allocated' then
    raise exception 'begin_inventory_pick: allocation % is %, not allocated -- cannot begin picking', p_allocation_id, v_allocation.status;
  end if;

  if not staff_has_node_access(v_allocation.fulfilment_node_id) then
    raise exception 'begin_inventory_pick: access denied for fulfilment node %', v_allocation.fulfilment_node_id
      using errcode = '42501';
  end if;

  perform lock_inventory_balance(v_allocation.fulfilment_node_id, v_allocation.sellable_sku_id);

  update inventory_balances
  set quantity_allocated = quantity_allocated - v_allocation.quantity,
      quantity_picking = quantity_picking + v_allocation.quantity,
      updated_at = now()
  where fulfilment_node_id = v_allocation.fulfilment_node_id and sellable_sku_id = v_allocation.sellable_sku_id;

  update inventory_allocations
  set status = 'picking', updated_at = now()
  where id = p_allocation_id
  returning * into v_allocation;

  insert into inventory_movements (
    organisation_id, fulfilment_node_id, sellable_sku_id, movement_type,
    quantity_delta, reference_type, reference_id, staff_user_id
  ) values (
    v_allocation.organisation_id, v_allocation.fulfilment_node_id, v_allocation.sellable_sku_id,
    'begin_picking', v_allocation.quantity, 'inventory_allocation', v_allocation.id, auth.uid()
  );

  return v_allocation;
end;
$$;

revoke execute on function begin_inventory_pick(uuid) from public, anon;
grant execute on function begin_inventory_pick(uuid) to authenticated;

create or replace function complete_inventory_pick(
  p_allocation_id uuid
) returns inventory_allocations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allocation inventory_allocations;
begin
  select * into v_allocation from inventory_allocations where id = p_allocation_id;

  if v_allocation is null then
    raise exception 'complete_inventory_pick: unknown allocation %', p_allocation_id;
  end if;

  -- Covers both "never begun" (status = 'allocated') and "already
  -- completed" (status = 'picked') -- a completed pick cannot be
  -- re-completed, per B-063's AC, and this is the same check that rejects
  -- both cases with one clear message rather than a silent no-op.
  if v_allocation.status <> 'picking' then
    raise exception 'complete_inventory_pick: allocation % is %, not picking -- cannot complete a pick that was never begun (or was already completed)', p_allocation_id, v_allocation.status;
  end if;

  if not staff_has_node_access(v_allocation.fulfilment_node_id) then
    raise exception 'complete_inventory_pick: access denied for fulfilment node %', v_allocation.fulfilment_node_id
      using errcode = '42501';
  end if;

  perform lock_inventory_balance(v_allocation.fulfilment_node_id, v_allocation.sellable_sku_id);

  update inventory_balances
  set quantity_picking = quantity_picking - v_allocation.quantity,
      quantity_on_hand = quantity_on_hand - v_allocation.quantity,
      updated_at = now()
  where fulfilment_node_id = v_allocation.fulfilment_node_id and sellable_sku_id = v_allocation.sellable_sku_id;

  update inventory_allocations
  set status = 'picked', updated_at = now()
  where id = p_allocation_id
  returning * into v_allocation;

  insert into inventory_movements (
    organisation_id, fulfilment_node_id, sellable_sku_id, movement_type,
    quantity_delta, reference_type, reference_id, staff_user_id
  ) values (
    v_allocation.organisation_id, v_allocation.fulfilment_node_id, v_allocation.sellable_sku_id,
    'complete_picking', -v_allocation.quantity, 'inventory_allocation', v_allocation.id, auth.uid()
  );

  return v_allocation;
end;
$$;

revoke execute on function complete_inventory_pick(uuid) from public, anon;
grant execute on function complete_inventory_pick(uuid) to authenticated;
