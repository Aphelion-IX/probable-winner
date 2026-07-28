-- Backfills a migration that was applied directly to the production
-- database (2026-07-24) but never committed to this repo, found by
-- auditing production's supabase_migrations.schema_migrations against
-- this directory (per the new "migrations must actually be deployed"
-- rule -- this is the same drift in the opposite direction: the database
-- had a change git didn't know about, rather than the other way round).
-- Reconstructed here verbatim from production's recorded migration
-- statements, applying no new behaviour -- release_inventory_reservation()
-- and allocate_order_inventory() have been running with these audit-event
-- calls in production the whole time; this file only makes that fact
-- visible in source control so a fresh `supabase db reset`/CI run
-- reproduces the same behaviour production already has.

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
  select * into v_reservation from inventory_reservations where id = p_reservation_id for update;

  if v_reservation is null then
    raise exception 'release_inventory_reservation: unknown reservation %', p_reservation_id;
  end if;

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

  perform emit_integration_event(
    v_reservation.organisation_id, 'inventory_balance_changed', 'inventory_balance', null,
    jsonb_build_object('fulfilmentNodeId', v_reservation.fulfilment_node_id, 'sellableSkuId', v_reservation.sellable_sku_id)
  );

  perform record_audit_event(
    v_reservation.organisation_id, 'inventory.release_reservation', 'inventory_reservation', v_reservation.id,
    jsonb_build_object(
      'fulfilmentNodeId', v_reservation.fulfilment_node_id, 'sellableSkuId', v_reservation.sellable_sku_id,
      'quantity', v_reservation.quantity
    )
  );

  return v_reservation;
end;
$$;

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
  select * into v_reservation from inventory_reservations where id = p_reservation_id for update;

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

  perform emit_integration_event(
    v_reservation.organisation_id, 'inventory_balance_changed', 'inventory_balance', null,
    jsonb_build_object('fulfilmentNodeId', v_reservation.fulfilment_node_id, 'sellableSkuId', v_reservation.sellable_sku_id)
  );

  perform record_audit_event(
    v_reservation.organisation_id, 'inventory.allocate', 'inventory_allocation', v_allocation.id,
    jsonb_build_object(
      'fulfilmentNodeId', v_reservation.fulfilment_node_id, 'sellableSkuId', v_reservation.sellable_sku_id,
      'quantity', v_reservation.quantity, 'orderLineId', p_order_line_id, 'reservationId', p_reservation_id
    )
  );

  return v_allocation;
end;
$$;
