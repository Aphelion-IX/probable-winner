-- reserve_inventory() and release_inventory_reservation() (blueprint §9.3,
-- backlog B-062).
--
-- quantity_delta convention (first established here, to be followed by
-- every later atomic function): the signed change to the single balance
-- column each movement_type most directly represents, not to
-- quantity_on_hand specifically. receive/return/buylist_acquisition are
-- positive against quantity_on_hand; sale/damage/transfer_out are negative
-- against quantity_on_hand; reserve is positive against quantity_reserved;
-- release_reservation is negative against quantity_reserved (the amount
-- released, matching how a reservation being undone mirrors the reserve
-- movement that created it).
--
-- Unlike receive_inventory()/adjust_inventory(), these two are NOT gated by
-- staff_has_node_access(): reserving stock is what happens when a customer
-- (guest or authenticated, per blueprint §10/backlog B-110's guest-cart
-- requirement) adds an item to their cart, so it must be callable by anon.
-- The safety property here is the oversell check itself (see below), not a
-- staff permission boundary.
--
-- cart ownership: inventory_reservations.cart_id has no FK yet (see the
-- schema migration's comment) and there is deliberately no "does the caller
-- own this reservation" check in release_inventory_reservation() below --
-- that requires the carts table (backlog B-110) to exist first. Until then,
-- both functions are usable by any anon/authenticated caller who knows a
-- reservation id, which is acceptable for a backend primitive with no
-- Server Action wired to it yet (backlog B-111).

create or replace function reserve_inventory(
  p_fulfilment_node_id uuid,
  p_sellable_sku_id uuid,
  p_quantity integer,
  p_cart_id uuid default null,
  p_expires_at timestamptz default null
) returns inventory_reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_organisation_id uuid;
  v_expires_at timestamptz := coalesce(p_expires_at, now() + interval '15 minutes');
  v_reservation inventory_reservations;
begin
  if p_quantity <= 0 then
    raise exception 'reserve_inventory: quantity must be positive, got %', p_quantity;
  end if;

  select organisation_id into v_organisation_id
  from fulfilment_nodes where id = p_fulfilment_node_id;

  if v_organisation_id is null then
    raise exception 'reserve_inventory: unknown fulfilment node %', p_fulfilment_node_id;
  end if;

  perform lock_inventory_balance(p_fulfilment_node_id, p_sellable_sku_id);

  begin
    update inventory_balances
    set quantity_reserved = quantity_reserved + p_quantity,
        quantity_available_online = quantity_available_online - p_quantity,
        updated_at = now()
    where fulfilment_node_id = p_fulfilment_node_id and sellable_sku_id = p_sellable_sku_id;
  exception when check_violation then
    raise exception 'reserve_inventory: insufficient available inventory for node %, sku %', p_fulfilment_node_id, p_sellable_sku_id
      using errcode = '23514';
  end;

  insert into inventory_reservations (
    organisation_id, fulfilment_node_id, sellable_sku_id, cart_id, quantity, expires_at
  ) values (
    v_organisation_id, p_fulfilment_node_id, p_sellable_sku_id, p_cart_id, p_quantity, v_expires_at
  )
  returning * into v_reservation;

  insert into inventory_movements (
    organisation_id, fulfilment_node_id, sellable_sku_id, movement_type,
    quantity_delta, reference_type, reference_id, staff_user_id
  ) values (
    v_organisation_id, p_fulfilment_node_id, p_sellable_sku_id, 'reserve',
    p_quantity, 'inventory_reservation', v_reservation.id, auth.uid()
  );

  return v_reservation;
end;
$$;

revoke execute on function reserve_inventory(uuid, uuid, integer, uuid, timestamptz) from public;
grant execute on function reserve_inventory(uuid, uuid, integer, uuid, timestamptz) to anon, authenticated;

create or replace function release_inventory_reservation(
  p_reservation_id uuid
) returns inventory_reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reservation inventory_reservations;
begin
  select * into v_reservation from inventory_reservations where id = p_reservation_id;

  if v_reservation is null then
    raise exception 'release_inventory_reservation: unknown reservation %', p_reservation_id;
  end if;

  -- No-op for an already-terminal reservation (active is the only status
  -- that still holds stock) -- calling release twice, or releasing an
  -- expired/cancelled/converted reservation, must not double-release.
  if v_reservation.status <> 'active' then
    return v_reservation;
  end if;

  perform lock_inventory_balance(v_reservation.fulfilment_node_id, v_reservation.sellable_sku_id);

  update inventory_balances
  set quantity_reserved = quantity_reserved - v_reservation.quantity,
      quantity_available_online = quantity_available_online + v_reservation.quantity,
      updated_at = now()
  where fulfilment_node_id = v_reservation.fulfilment_node_id and sellable_sku_id = v_reservation.sellable_sku_id;

  update inventory_reservations
  set status = 'released', updated_at = now()
  where id = p_reservation_id
  returning * into v_reservation;

  insert into inventory_movements (
    organisation_id, fulfilment_node_id, sellable_sku_id, movement_type,
    quantity_delta, reference_type, reference_id, staff_user_id
  ) values (
    v_reservation.organisation_id, v_reservation.fulfilment_node_id, v_reservation.sellable_sku_id,
    'release_reservation', -v_reservation.quantity, 'inventory_reservation', v_reservation.id, auth.uid()
  );

  return v_reservation;
end;
$$;

revoke execute on function release_inventory_reservation(uuid) from public;
grant execute on function release_inventory_reservation(uuid) to anon, authenticated;
