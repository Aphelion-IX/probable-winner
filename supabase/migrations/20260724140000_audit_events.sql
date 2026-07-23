-- Audit log coverage (backlog B-204, blueprint §8.10/§24). Every
-- state-changing atomic function across inventory (B-061-B-063),
-- transfers (B-071), and pricing approvals (B-163-B-164) now writes one
-- audit_events row per state change, in the same transaction as the
-- change itself -- same reasoning as integration_events (migration
-- 20260723065043): a rolled-back transaction leaves no orphaned audit
-- row, since the insert lives inside the same function, not a follow-up
-- write. Payments (blueprint B-124) has no atomic functions yet --
-- checkout is still a placeholder page -- so there is nothing to wire up
-- there; the pattern below is what that work should follow when it lands.

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_events_org_idx on audit_events (organisation_id);
create index audit_events_entity_idx on audit_events (entity_type, entity_id);
create index audit_events_actor_idx on audit_events (actor_id);
create index audit_events_created_idx on audit_events (created_at);

-- RLS: staff read audit events scoped to their organisation access, same
-- policy shape as published_prices (migration 20260723082400). No direct
-- writes via the Data API -- record_audit_event() below is the only writer,
-- called only from other SECURITY DEFINER atomic functions.
alter table audit_events enable row level security;

create policy audit_events_select on audit_events
  for select to authenticated
  using (staff_has_org_access(organisation_id));

-- security definer: same reasoning as emit_integration_event() (migration
-- 20260723065043) -- locked down to callable only from other SECURITY
-- DEFINER functions owned by the same role; nothing calls this directly.
create or replace function record_audit_event(
  p_organisation_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
begin
  insert into audit_events (organisation_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_organisation_id, auth.uid(), p_action, p_entity_type, p_entity_id, p_metadata)
  returning id into v_event_id;

  return v_event_id;
end;
$$;

revoke execute on function record_audit_event(uuid, text, text, uuid, jsonb) from public, anon, authenticated;

-- ============================================================================
-- Inventory functions (B-061-B-063): re-created with exactly one addition
-- each -- a call to record_audit_event() for the row the function changed,
-- right before its final return. No other behavior changes.
-- ============================================================================

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

  perform emit_integration_event(
    v_organisation_id, 'inventory_balance_changed', 'inventory_balance', null,
    jsonb_build_object('fulfilmentNodeId', p_fulfilment_node_id, 'sellableSkuId', p_sellable_sku_id)
  );

  perform record_audit_event(
    v_organisation_id, 'inventory.receive', 'inventory_movement', v_movement.id,
    jsonb_build_object(
      'fulfilmentNodeId', p_fulfilment_node_id, 'sellableSkuId', p_sellable_sku_id,
      'quantity', p_quantity, 'referenceType', p_reference_type, 'referenceId', p_reference_id
    )
  );

  return v_movement;
end;
$$;

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

  update inventory_balances
  set quantity_on_hand = quantity_on_hand + p_quantity_delta,
      quantity_available_online = quantity_available_online + p_quantity_delta,
      updated_at = now()
  where fulfilment_node_id = p_fulfilment_node_id and sellable_sku_id = p_sellable_sku_id;

  perform emit_integration_event(
    v_organisation_id, 'inventory_balance_changed', 'inventory_balance', null,
    jsonb_build_object('fulfilmentNodeId', p_fulfilment_node_id, 'sellableSkuId', p_sellable_sku_id)
  );

  perform record_audit_event(
    v_organisation_id, 'inventory.adjust', 'inventory_movement', v_movement.id,
    jsonb_build_object(
      'fulfilmentNodeId', p_fulfilment_node_id, 'sellableSkuId', p_sellable_sku_id,
      'movementType', p_movement_type, 'quantityDelta', p_quantity_delta, 'reason', p_reason
    )
  );

  return v_movement;
end;
$$;

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

  perform emit_integration_event(
    v_organisation_id, 'inventory_balance_changed', 'inventory_balance', null,
    jsonb_build_object('fulfilmentNodeId', p_fulfilment_node_id, 'sellableSkuId', p_sellable_sku_id)
  );

  perform record_audit_event(
    v_organisation_id, 'inventory.reserve', 'inventory_reservation', v_reservation.id,
    jsonb_build_object(
      'fulfilmentNodeId', p_fulfilment_node_id, 'sellableSkuId', p_sellable_sku_id,
      'quantity', p_quantity, 'cartId', p_cart_id, 'expiresAt', v_expires_at
    )
  );

  return v_reservation;
end;
$$;

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

  perform emit_integration_event(
    v_allocation.organisation_id, 'inventory_balance_changed', 'inventory_balance', null,
    jsonb_build_object('fulfilmentNodeId', v_allocation.fulfilment_node_id, 'sellableSkuId', v_allocation.sellable_sku_id)
  );

  perform record_audit_event(
    v_allocation.organisation_id, 'inventory.begin_pick', 'inventory_allocation', v_allocation.id,
    jsonb_build_object(
      'fulfilmentNodeId', v_allocation.fulfilment_node_id, 'sellableSkuId', v_allocation.sellable_sku_id,
      'quantity', v_allocation.quantity
    )
  );

  return v_allocation;
end;
$$;

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

  perform emit_integration_event(
    v_allocation.organisation_id, 'inventory_balance_changed', 'inventory_balance', null,
    jsonb_build_object('fulfilmentNodeId', v_allocation.fulfilment_node_id, 'sellableSkuId', v_allocation.sellable_sku_id)
  );

  perform record_audit_event(
    v_allocation.organisation_id, 'inventory.complete_pick', 'inventory_allocation', v_allocation.id,
    jsonb_build_object(
      'fulfilmentNodeId', v_allocation.fulfilment_node_id, 'sellableSkuId', v_allocation.sellable_sku_id,
      'quantity', v_allocation.quantity
    )
  );

  return v_allocation;
end;
$$;

create or replace function quarantine_inventory(
  p_fulfilment_node_id uuid,
  p_sellable_sku_id uuid,
  p_quantity integer,
  p_reason text,
  p_reference_type text default null,
  p_reference_id uuid default null
) returns quarantined_inventory
language plpgsql
security definer
set search_path = public
as $$
declare
  v_organisation_id uuid;
  v_record quarantined_inventory;
begin
  if p_quantity <= 0 then
    raise exception 'quarantine_inventory: quantity must be positive, got %', p_quantity;
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'quarantine_inventory: a reason is required';
  end if;

  select organisation_id into v_organisation_id
  from fulfilment_nodes where id = p_fulfilment_node_id;

  if v_organisation_id is null then
    raise exception 'quarantine_inventory: unknown fulfilment node %', p_fulfilment_node_id;
  end if;

  if not staff_has_node_access(p_fulfilment_node_id) then
    raise exception 'quarantine_inventory: access denied for fulfilment node %', p_fulfilment_node_id
      using errcode = '42501';
  end if;

  perform lock_inventory_balance(p_fulfilment_node_id, p_sellable_sku_id);

  begin
    update inventory_balances
    set quantity_quarantined = quantity_quarantined + p_quantity,
        quantity_available_online = quantity_available_online - p_quantity,
        updated_at = now()
    where fulfilment_node_id = p_fulfilment_node_id and sellable_sku_id = p_sellable_sku_id;
  exception when check_violation then
    raise exception 'quarantine_inventory: insufficient available inventory to quarantine for node %, sku %', p_fulfilment_node_id, p_sellable_sku_id
      using errcode = '23514';
  end;

  insert into quarantined_inventory (
    organisation_id, fulfilment_node_id, sellable_sku_id, quantity, reason, reference_type, reference_id
  ) values (
    v_organisation_id, p_fulfilment_node_id, p_sellable_sku_id, p_quantity, p_reason, p_reference_type, p_reference_id
  )
  returning * into v_record;

  insert into inventory_movements (
    organisation_id, fulfilment_node_id, sellable_sku_id, movement_type,
    quantity_delta, reference_type, reference_id, staff_user_id, reason
  ) values (
    v_organisation_id, p_fulfilment_node_id, p_sellable_sku_id, 'quarantine',
    p_quantity, 'quarantined_inventory', v_record.id, auth.uid(), p_reason
  );

  perform emit_integration_event(
    v_organisation_id, 'inventory_balance_changed', 'inventory_balance', null,
    jsonb_build_object('fulfilmentNodeId', p_fulfilment_node_id, 'sellableSkuId', p_sellable_sku_id)
  );

  perform record_audit_event(
    v_organisation_id, 'inventory.quarantine', 'quarantined_inventory', v_record.id,
    jsonb_build_object(
      'fulfilmentNodeId', p_fulfilment_node_id, 'sellableSkuId', p_sellable_sku_id,
      'quantity', p_quantity, 'reason', p_reason
    )
  );

  return v_record;
end;
$$;

create or replace function release_inventory_quarantine(
  p_quarantine_id uuid
) returns quarantined_inventory
language plpgsql
security definer
set search_path = public
as $$
declare
  v_record quarantined_inventory;
begin
  select * into v_record from quarantined_inventory where id = p_quarantine_id;

  if v_record is null then
    raise exception 'release_inventory_quarantine: unknown quarantine record %', p_quarantine_id;
  end if;

  if not staff_has_node_access(v_record.fulfilment_node_id) then
    raise exception 'release_inventory_quarantine: access denied for fulfilment node %', v_record.fulfilment_node_id
      using errcode = '42501';
  end if;

  if v_record.status <> 'quarantined' then
    return v_record;
  end if;

  perform lock_inventory_balance(v_record.fulfilment_node_id, v_record.sellable_sku_id);

  update inventory_balances
  set quantity_quarantined = quantity_quarantined - v_record.quantity,
      quantity_available_online = quantity_available_online + v_record.quantity,
      updated_at = now()
  where fulfilment_node_id = v_record.fulfilment_node_id and sellable_sku_id = v_record.sellable_sku_id;

  update quarantined_inventory
  set status = 'released', released_at = now(), updated_at = now()
  where id = p_quarantine_id
  returning * into v_record;

  insert into inventory_movements (
    organisation_id, fulfilment_node_id, sellable_sku_id, movement_type,
    quantity_delta, reference_type, reference_id, staff_user_id
  ) values (
    v_record.organisation_id, v_record.fulfilment_node_id, v_record.sellable_sku_id,
    'quarantine', -v_record.quantity, 'quarantined_inventory', v_record.id, auth.uid()
  );

  perform emit_integration_event(
    v_record.organisation_id, 'inventory_balance_changed', 'inventory_balance', null,
    jsonb_build_object('fulfilmentNodeId', v_record.fulfilment_node_id, 'sellableSkuId', v_record.sellable_sku_id)
  );

  perform record_audit_event(
    v_record.organisation_id, 'inventory.release_quarantine', 'quarantined_inventory', v_record.id,
    jsonb_build_object(
      'fulfilmentNodeId', v_record.fulfilment_node_id, 'sellableSkuId', v_record.sellable_sku_id,
      'quantity', v_record.quantity
    )
  );

  return v_record;
end;
$$;

-- ============================================================================
-- Transfer functions (B-071): dispatch writes one audit row per line
-- (mirrors the per-line integration event it already emits); receive
-- writes one audit row per receipt line with a good quantity > 0.
-- ============================================================================

create or replace function dispatch_transfer(
  p_transfer_order_id uuid
) returns transfer_shipments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transfer transfer_orders;
  v_shipment transfer_shipments;
  v_line record;
begin
  select * into v_transfer from transfer_orders where id = p_transfer_order_id;
  if v_transfer is null then
    raise exception 'dispatch_transfer: unknown transfer order %', p_transfer_order_id;
  end if;

  if v_transfer.status <> 'picking' then
    raise exception 'dispatch_transfer: transfer order % is %, not picking -- cannot dispatch', p_transfer_order_id, v_transfer.status;
  end if;

  if not staff_has_node_access(v_transfer.source_fulfilment_node_id) then
    raise exception 'dispatch_transfer: access denied for fulfilment node %', v_transfer.source_fulfilment_node_id
      using errcode = '42501';
  end if;

  insert into transfer_shipments (transfer_order_id, dispatched_by)
  values (p_transfer_order_id, auth.uid())
  returning * into v_shipment;

  for v_line in select * from transfer_order_lines where transfer_order_id = p_transfer_order_id
  loop
    perform lock_inventory_balance(v_transfer.source_fulfilment_node_id, v_line.sellable_sku_id);

    begin
      update inventory_balances
      set quantity_on_hand = quantity_on_hand - v_line.quantity_requested,
          quantity_available_online = quantity_available_online - v_line.quantity_requested,
          updated_at = now()
      where fulfilment_node_id = v_transfer.source_fulfilment_node_id and sellable_sku_id = v_line.sellable_sku_id;
    exception when check_violation then
      raise exception 'dispatch_transfer: insufficient available inventory to dispatch sku % from node %', v_line.sellable_sku_id, v_transfer.source_fulfilment_node_id
        using errcode = '23514';
    end;

    insert into inventory_movements (
      organisation_id, fulfilment_node_id, sellable_sku_id, movement_type,
      quantity_delta, reference_type, reference_id, staff_user_id
    ) values (
      v_transfer.organisation_id, v_transfer.source_fulfilment_node_id, v_line.sellable_sku_id, 'transfer_out',
      -v_line.quantity_requested, 'transfer_shipment', v_shipment.id, auth.uid()
    );

    perform emit_integration_event(
      v_transfer.organisation_id, 'inventory_balance_changed', 'inventory_balance', null,
      jsonb_build_object('fulfilmentNodeId', v_transfer.source_fulfilment_node_id, 'sellableSkuId', v_line.sellable_sku_id)
    );

    perform record_audit_event(
      v_transfer.organisation_id, 'transfer.dispatch', 'transfer_shipment', v_shipment.id,
      jsonb_build_object(
        'transferOrderId', p_transfer_order_id, 'sourceFulfilmentNodeId', v_transfer.source_fulfilment_node_id,
        'sellableSkuId', v_line.sellable_sku_id, 'quantity', v_line.quantity_requested
      )
    );
  end loop;

  update transfer_orders set status = 'dispatched', updated_at = now() where id = p_transfer_order_id;

  return v_shipment;
end;
$$;

create or replace function receive_transfer(
  p_transfer_order_id uuid,
  p_lines jsonb
) returns setof transfer_receipts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transfer transfer_orders;
  v_shipment_id uuid;
  v_line jsonb;
  v_sku_id uuid;
  v_good integer;
  v_damaged integer;
  v_missing integer;
  v_requested integer;
  v_already_accounted integer;
  v_receipt transfer_receipts;
  v_all_accounted boolean;
begin
  select * into v_transfer from transfer_orders where id = p_transfer_order_id;
  if v_transfer is null then
    raise exception 'receive_transfer: unknown transfer order %', p_transfer_order_id;
  end if;

  if v_transfer.status not in ('dispatched', 'in_transit', 'partially_received') then
    raise exception 'receive_transfer: transfer order % is %, not dispatched/in_transit/partially_received -- cannot receive', p_transfer_order_id, v_transfer.status;
  end if;

  if not staff_has_node_access(v_transfer.destination_fulfilment_node_id) then
    raise exception 'receive_transfer: access denied for fulfilment node %', v_transfer.destination_fulfilment_node_id
      using errcode = '42501';
  end if;

  select id into v_shipment_id from transfer_shipments where transfer_order_id = p_transfer_order_id order by dispatched_at desc limit 1;
  if v_shipment_id is null then
    raise exception 'receive_transfer: transfer order % has no dispatched shipment', p_transfer_order_id;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_sku_id := (v_line ->> 'sellableSkuId')::uuid;
    v_good := coalesce((v_line ->> 'quantityGood')::integer, 0);
    v_damaged := coalesce((v_line ->> 'quantityDamaged')::integer, 0);
    v_missing := coalesce((v_line ->> 'quantityMissing')::integer, 0);

    select quantity_requested into v_requested
    from transfer_order_lines
    where transfer_order_id = p_transfer_order_id and sellable_sku_id = v_sku_id;

    if v_requested is null then
      raise exception 'receive_transfer: sku % is not part of transfer order %', v_sku_id, p_transfer_order_id;
    end if;

    select coalesce(sum(quantity_good + quantity_damaged + quantity_missing), 0) into v_already_accounted
    from transfer_receipts
    where transfer_order_id = p_transfer_order_id and sellable_sku_id = v_sku_id;

    if v_already_accounted + v_good + v_damaged + v_missing > v_requested then
      raise exception 'receive_transfer: sku % would account for more than the requested quantity % (already accounted %, this receipt %)',
        v_sku_id, v_requested, v_already_accounted, v_good + v_damaged + v_missing;
    end if;

    insert into transfer_receipts (
      transfer_order_id, transfer_shipment_id, sellable_sku_id,
      quantity_good, quantity_damaged, quantity_missing, received_by
    ) values (
      p_transfer_order_id, v_shipment_id, v_sku_id, v_good, v_damaged, v_missing, auth.uid()
    )
    returning * into v_receipt;

    if v_good > 0 then
      perform lock_inventory_balance(v_transfer.destination_fulfilment_node_id, v_sku_id);

      update inventory_balances
      set quantity_on_hand = quantity_on_hand + v_good,
          quantity_available_online = quantity_available_online + v_good,
          updated_at = now()
      where fulfilment_node_id = v_transfer.destination_fulfilment_node_id and sellable_sku_id = v_sku_id;

      insert into inventory_movements (
        organisation_id, fulfilment_node_id, sellable_sku_id, movement_type,
        quantity_delta, reference_type, reference_id, staff_user_id
      ) values (
        v_transfer.organisation_id, v_transfer.destination_fulfilment_node_id, v_sku_id, 'transfer_in',
        v_good, 'transfer_receipt', v_receipt.id, auth.uid()
      );

      perform emit_integration_event(
        v_transfer.organisation_id, 'inventory_balance_changed', 'inventory_balance', null,
        jsonb_build_object('fulfilmentNodeId', v_transfer.destination_fulfilment_node_id, 'sellableSkuId', v_sku_id)
      );
    end if;

    perform record_audit_event(
      v_transfer.organisation_id, 'transfer.receive', 'transfer_receipt', v_receipt.id,
      jsonb_build_object(
        'transferOrderId', p_transfer_order_id, 'destinationFulfilmentNodeId', v_transfer.destination_fulfilment_node_id,
        'sellableSkuId', v_sku_id, 'quantityGood', v_good, 'quantityDamaged', v_damaged, 'quantityMissing', v_missing
      )
    );

    return next v_receipt;
  end loop;

  select bool_and(fully_accounted) into v_all_accounted
  from (
    select
      tol.quantity_requested <= coalesce((
        select sum(quantity_good + quantity_damaged + quantity_missing)
        from transfer_receipts tr
        where tr.transfer_order_id = p_transfer_order_id and tr.sellable_sku_id = tol.sellable_sku_id
      ), 0) as fully_accounted
    from transfer_order_lines tol
    where tol.transfer_order_id = p_transfer_order_id
  ) sub;

  if v_all_accounted then
    update transfer_orders set status = 'received', updated_at = now() where id = p_transfer_order_id;
  else
    update transfer_orders set status = 'partially_received', updated_at = now() where id = p_transfer_order_id and status <> 'partially_received';
  end if;

  return;
end;
$$;

-- ============================================================================
-- Pricing approval functions (B-163-B-164): re-created with a
-- record_audit_event() call added, same as above. Also fixes two
-- pre-existing bugs discovered while touching these functions, both of
-- which mean every one of these six functions currently fails at runtime
-- before this migration:
--
-- 1. Every "insert into integration_events (... event_data)" here targets
--    a column that does not exist -- the table (migration 20260723065043)
--    has "payload", not "event_data" -- and omits the required
--    organisation_id. Fixed to use the real column names.
-- 2. clear_price_override()'s parameters are named identically to the
--    columns they're compared against (published_price_id,
--    fulfilment_node_id), so its WHERE clauses are ambiguous column
--    references under Postgres's default plpgsql.variable_conflict=error
--    -- every call raises before ever reaching the delete. Fixed by
--    prefixing its parameters with p_, matching the convention already
--    used everywhere else in this file.
-- ============================================================================

create or replace function approve_suggested_price(
  calculated_price_id uuid
) returns json as $$
declare
  v_price record;
begin
  select * into v_price from calculated_prices where id = calculated_price_id for update;
  if v_price is null then
    raise exception 'calculated_price not found: %', calculated_price_id;
  end if;

  if v_price.status = 'approved' then
    raise exception 'price already approved: %', calculated_price_id;
  end if;

  if v_price.status = 'rejected' then
    raise exception 'cannot approve a rejected price: %', calculated_price_id;
  end if;

  update calculated_prices
    set status = 'approved', updated_at = now()
    where id = calculated_price_id;

  insert into integration_events (organisation_id, aggregate_id, aggregate_type, event_type, payload)
    values (
      v_price.organisation_id,
      calculated_price_id,
      'calculated_price',
      'pricing_approved',
      jsonb_build_object(
        'calculated_price_id', calculated_price_id,
        'final_amount', v_price.final_amount,
        'currency', v_price.currency,
        'approved_by', auth.uid(),
        'approved_at', now()
      )
    );

  perform record_audit_event(
    v_price.organisation_id, 'pricing.approve', 'calculated_price', calculated_price_id,
    jsonb_build_object('finalAmount', v_price.final_amount, 'currency', v_price.currency)
  );

  return jsonb_build_object(
    'id', v_price.id,
    'status', 'approved'
  );
end;
$$ language plpgsql security definer;

create or replace function override_suggested_price(
  calculated_price_id uuid,
  override_amount numeric
) returns json as $$
declare
  v_price record;
begin
  if override_amount < 0 then
    raise exception 'override amount cannot be negative: %', override_amount;
  end if;

  select * into v_price from calculated_prices where id = calculated_price_id for update;
  if v_price is null then
    raise exception 'calculated_price not found: %', calculated_price_id;
  end if;

  if v_price.status = 'rejected' then
    raise exception 'cannot override a rejected price: %', calculated_price_id;
  end if;

  -- Store the original calculated final_amount in a jsonb metadata field
  -- so the audit trail shows what was calculated vs. what was overridden.
  update calculated_prices
    set
      final_amount = override_amount,
      status = 'approved',
      updated_at = now(),
      -- Track override in metadata for full auditability.
      metadata = jsonb_build_object(
        'original_final_amount', v_price.final_amount,
        'override_amount', override_amount,
        'override_reason', 'manual_staff_override'
      )
    where id = calculated_price_id;

  insert into integration_events (organisation_id, aggregate_id, aggregate_type, event_type, payload)
    values (
      v_price.organisation_id,
      calculated_price_id,
      'calculated_price',
      'pricing_overridden',
      jsonb_build_object(
        'calculated_price_id', calculated_price_id,
        'original_final_amount', v_price.final_amount,
        'override_amount', override_amount,
        'currency', v_price.currency,
        'overridden_by', auth.uid(),
        'overridden_at', now()
      )
    );

  perform record_audit_event(
    v_price.organisation_id, 'pricing.override', 'calculated_price', calculated_price_id,
    jsonb_build_object(
      'originalFinalAmount', v_price.final_amount, 'overrideAmount', override_amount, 'currency', v_price.currency
    )
  );

  return jsonb_build_object(
    'id', v_price.id,
    'original_final_amount', v_price.final_amount,
    'override_amount', override_amount,
    'status', 'approved'
  );
end;
$$ language plpgsql security definer;

create or replace function reject_suggested_price(
  calculated_price_id uuid
) returns json as $$
declare
  v_price record;
begin
  select * into v_price from calculated_prices where id = calculated_price_id for update;
  if v_price is null then
    raise exception 'calculated_price not found: %', calculated_price_id;
  end if;

  if v_price.status = 'approved' then
    raise exception 'cannot reject an approved price: %', calculated_price_id;
  end if;

  update calculated_prices
    set status = 'rejected', updated_at = now()
    where id = calculated_price_id;

  insert into integration_events (organisation_id, aggregate_id, aggregate_type, event_type, payload)
    values (
      v_price.organisation_id,
      calculated_price_id,
      'calculated_price',
      'pricing_rejected',
      jsonb_build_object(
        'calculated_price_id', calculated_price_id,
        'rejected_by', auth.uid(),
        'rejected_at', now()
      )
    );

  perform record_audit_event(
    v_price.organisation_id, 'pricing.reject', 'calculated_price', calculated_price_id, '{}'::jsonb
  );

  return jsonb_build_object(
    'id', v_price.id,
    'status', 'rejected'
  );
end;
$$ language plpgsql security definer;

create or replace function publish_suggested_price(
  calculated_price_id uuid
) returns json as $$
declare
  v_calc record;
  v_rule record;
  v_published record;
begin
  select cp.* into v_calc from calculated_prices cp where cp.id = calculated_price_id;
  if v_calc is null then
    raise exception 'calculated_price not found: %', calculated_price_id;
  end if;

  if v_calc.status != 'approved' then
    raise exception 'can only publish approved prices, current status: %', v_calc.status;
  end if;

  select * into v_rule from pricing_rules where id = v_calc.pricing_rule_id;
  if v_rule is null then
    raise exception 'pricing_rule not found: %', v_calc.pricing_rule_id;
  end if;

  -- Insert or update the published price (upsert).
  insert into published_prices (
    organisation_id, pricing_rule_id, sellable_sku_id, calculated_price_id,
    final_amount, currency, status
  )
  values (
    v_rule.organisation_id, v_rule.id, v_calc.sellable_sku_id, calculated_price_id,
    v_calc.final_amount, v_calc.currency, 'active'
  )
  on conflict (sellable_sku_id, organisation_id, currency) do update
  set
    calculated_price_id = excluded.calculated_price_id,
    final_amount = excluded.final_amount,
    status = 'active',
    updated_at = now()
  returning * into v_published;

  insert into integration_events (organisation_id, aggregate_id, aggregate_type, event_type, payload)
    values (
      v_published.organisation_id,
      v_published.id,
      'published_price',
      'pricing_published',
      jsonb_build_object(
        'published_price_id', v_published.id,
        'sellable_sku_id', v_published.sellable_sku_id,
        'final_amount', v_published.final_amount,
        'currency', v_published.currency,
        'organisation_id', v_published.organisation_id,
        'published_at', now()
      )
    );

  perform record_audit_event(
    v_published.organisation_id, 'pricing.publish', 'published_price', v_published.id,
    jsonb_build_object(
      'sellableSkuId', v_published.sellable_sku_id, 'finalAmount', v_published.final_amount,
      'currency', v_published.currency, 'calculatedPriceId', calculated_price_id
    )
  );

  return jsonb_build_object(
    'id', v_published.id,
    'final_amount', v_published.final_amount,
    'currency', v_published.currency,
    'status', 'published'
  );
end;
$$ language plpgsql security definer;

create or replace function set_price_override(
  p_published_price_id uuid,
  p_fulfilment_node_id uuid,
  p_override_amount numeric,
  p_reason text default null
) returns json as $$
declare
  v_published record;
  v_override record;
begin
  if p_override_amount < 0 then
    raise exception 'override amount cannot be negative: %', p_override_amount;
  end if;

  select * into v_published from published_prices where id = p_published_price_id;
  if v_published is null then
    raise exception 'published_price not found: %', p_published_price_id;
  end if;

  -- Verify the fulfilment_node exists and belongs to the same organisation.
  if not exists (
    select 1 from fulfilment_nodes fn
    where fn.id = p_fulfilment_node_id and fn.organisation_id = v_published.organisation_id
  ) then
    raise exception 'fulfilment_node % not found in organisation %',
      p_fulfilment_node_id, v_published.organisation_id;
  end if;

  insert into published_price_overrides (
    published_price_id, fulfilment_node_id, override_amount, reason
  )
  values (p_published_price_id, p_fulfilment_node_id, p_override_amount, p_reason)
  on conflict (published_price_id, fulfilment_node_id) do update
  set
    override_amount = excluded.override_amount,
    reason = excluded.reason,
    updated_at = now()
  returning * into v_override;

  insert into integration_events (organisation_id, aggregate_id, aggregate_type, event_type, payload)
    values (
      v_published.organisation_id,
      p_published_price_id,
      'published_price',
      'pricing_override_set',
      jsonb_build_object(
        'published_price_id', p_published_price_id,
        'fulfilment_node_id', p_fulfilment_node_id,
        'override_amount', p_override_amount,
        'reason', p_reason,
        'set_at', now()
      )
    );

  perform record_audit_event(
    v_published.organisation_id, 'pricing.set_override', 'published_price_override', v_override.id,
    jsonb_build_object(
      'publishedPriceId', p_published_price_id, 'fulfilmentNodeId', p_fulfilment_node_id,
      'overrideAmount', p_override_amount, 'reason', p_reason
    )
  );

  return jsonb_build_object(
    'id', v_override.id,
    'published_price_id', p_published_price_id,
    'fulfilment_node_id', p_fulfilment_node_id,
    'override_amount', p_override_amount
  );
end;
$$ language plpgsql security definer;

create or replace function clear_price_override(
  p_published_price_id uuid,
  p_fulfilment_node_id uuid
) returns json as $$
declare
  v_published record;
  v_override record;
begin
  select * into v_published from published_prices where id = p_published_price_id;
  if v_published is null then
    raise exception 'published_price not found: %', p_published_price_id;
  end if;

  select * into v_override from published_price_overrides
    where published_price_id = p_published_price_id
      and fulfilment_node_id = p_fulfilment_node_id;

  if v_override is null then
    raise exception 'no override found for published_price % at node %',
      p_published_price_id, p_fulfilment_node_id;
  end if;

  delete from published_price_overrides
    where published_price_id = p_published_price_id
      and fulfilment_node_id = p_fulfilment_node_id;

  insert into integration_events (organisation_id, aggregate_id, aggregate_type, event_type, payload)
    values (
      v_published.organisation_id,
      p_published_price_id,
      'published_price',
      'pricing_override_cleared',
      jsonb_build_object(
        'published_price_id', p_published_price_id,
        'fulfilment_node_id', p_fulfilment_node_id,
        'cleared_at', now()
      )
    );

  perform record_audit_event(
    v_published.organisation_id, 'pricing.clear_override', 'published_price_override', v_override.id,
    jsonb_build_object('publishedPriceId', p_published_price_id, 'fulfilmentNodeId', p_fulfilment_node_id)
  );

  return jsonb_build_object(
    'id', p_published_price_id,
    'fulfilment_node_id', p_fulfilment_node_id,
    'status', 'override_cleared'
  );
end;
$$ language plpgsql security definer;
