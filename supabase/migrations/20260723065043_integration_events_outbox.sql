-- integration_events outbox (blueprint §8.10/§13.3, backlog B-082). Every
-- atomic inventory function built so far (B-061-B-071) is retrofitted here
-- to emit one event per balance it touches, in the same transaction as the
-- balance change -- a rolled-back inventory transaction leaves no
-- orphaned event, since the insert lives inside the same function/
-- transaction, not a separate follow-up write. This is the piece that lets
-- backlog B-083's future worker consumer update Typesense incrementally
-- instead of a full reindex per change (blueprint §13.3's outbox diagram:
-- inventory transaction -> integration event -> queue message ->
-- background worker -> Typesense update).
--
-- Payload is deliberately minimal ("this (node, sku) balance changed"),
-- not a full balance snapshot -- the eventual consumer re-reads current
-- state from inventory_balances rather than trusting a potentially-stale
-- embedded snapshot, standard outbox practice.

create table integration_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  event_type text not null,
  aggregate_type text not null,
  aggregate_id uuid,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index integration_events_org_idx on integration_events (organisation_id);
create index integration_events_created_idx on integration_events (created_at);

-- No RLS policies at all -- same reasoning as the catalogue staging tables
-- (migration 20260722113847): this is internal worker plumbing, not
-- staff- or customer-facing data. Only a trusted backend connection
-- (which bypasses RLS entirely) ever reads it.
alter table integration_events enable row level security;

-- security definer: same reason as enqueue_stock_reconciliation()
-- (migration 20260723063559) -- authenticated has no USAGE on the pgmq
-- schema, so emitting the queue message needs the function owner's
-- privileges. Locked down to callable only from other SECURITY DEFINER
-- functions owned by the same role (see the revoke below) -- nothing
-- calls this directly.
create or replace function emit_integration_event(
  p_organisation_id uuid,
  p_event_type text,
  p_aggregate_type text,
  p_aggregate_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
begin
  insert into integration_events (organisation_id, event_type, aggregate_type, aggregate_id, payload)
  values (p_organisation_id, p_event_type, p_aggregate_type, p_aggregate_id, p_payload)
  returning id into v_event_id;

  perform pgmq.send('search_index', jsonb_build_object('integrationEventId', v_event_id, 'eventType', p_event_type));

  return v_event_id;
end;
$$;

revoke execute on function emit_integration_event(uuid, text, text, uuid, jsonb) from public, anon, authenticated;

-- Below: every B-061-B-071 atomic function, re-created with exactly one
-- addition each -- a call to emit_integration_event() for every balance
-- row the function touches, right before its final return. No other
-- behavior changes.

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

  return v_record;
end;
$$;

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
