-- Wires the picking -> packing -> shipping pipeline together end to end
-- (backlog B-142/B-144, follow-up to the 2026-07-26 security re-audit's
-- item 9). Before this migration:
--
--   * There was no function to record an individual pick_line as picked --
--     apps/web/src/app/staff/picking/[id]/page.tsx's scan handler only
--     updated local React state (a comment on it said as much: "In a real
--     implementation, this would ... call a Server Action to update
--     database"). Nothing ever called begin_inventory_pick()/
--     complete_inventory_pick(), so a "picked" item never actually left
--     quantity_allocated/quantity_on_hand.
--   * complete_pick_batch() let a batch be marked completed with pick
--     lines still unpicked.
--   * Nothing ever moved orders.status past 'paid' -- begin_pick_batch(),
--     create_shipment(), generate_shipment_label() and
--     mark_shipment_shipped() all mutate their own tables but never touch
--     the order(s) whose lines they cover, and mark_shipment_shipped()
--     never wrote the customer-facing `shipments` table (orders_and_shipments_v2)
--     that account order-tracking pages read from.
--
-- A pick batch/shipment can cover lines from more than one order (
-- create_pick_batch() pulls allocations across a whole node, not scoped to
-- one order), so every order-status transition below is applied to every
-- distinct order the batch's lines belong to, not just "the" order.

-- Helper: every distinct order covered by a pick batch's lines. Not exposed
-- over the Data API (revoked from anon/authenticated below) -- it exists
-- purely so the four functions that need this join don't each repeat it.
create or replace function orders_for_pick_batch(p_batch_id uuid)
returns setof uuid
language sql
stable
security invoker
set search_path = public
as $$
  select distinct ol.order_id
  from pick_lines pl
  join order_lines ol on ol.id = pl.order_line_id
  where pl.pick_batch_id = p_batch_id;
$$;

revoke execute on function orders_for_pick_batch(uuid) from public, anon, authenticated;

-- Record one physical scan against a pick line: increments quantity_picked
-- by one (a scan is one physical item), and once the line's full quantity
-- has been scanned, converts its allocation into removed-from-stock via the
-- same begin_inventory_pick()/complete_inventory_pick() functions B-063
-- already defined for this exact purpose -- there is no separate "start"
-- moment at the line level, a scan means "I just physically picked this
-- unit", so both run together.
create or replace function record_pick_line_scan(
  p_pick_line_id uuid,
  p_condition_confirmed text default 'match'
) returns pick_lines
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line pick_lines;
  v_batch pick_batches;
begin
  select * into v_line from pick_lines where id = p_pick_line_id for update;
  if v_line is null then
    raise exception 'record_pick_line_scan: unknown pick line %', p_pick_line_id;
  end if;

  select * into v_batch from pick_batches where id = v_line.pick_batch_id;

  if not staff_has_node_access(v_batch.fulfilment_node_id) then
    raise exception 'record_pick_line_scan: access denied for fulfilment node %', v_batch.fulfilment_node_id
      using errcode = '42501';
  end if;

  if v_batch.status <> 'in_progress' then
    raise exception 'record_pick_line_scan: batch % is %, not in_progress', v_batch.id, v_batch.status;
  end if;

  if v_line.quantity_picked >= v_line.quantity_to_pick then
    raise exception 'record_pick_line_scan: pick line % is already fully picked', p_pick_line_id;
  end if;

  update pick_lines
  set quantity_picked = quantity_picked + 1,
      scan_count = scan_count + 1,
      condition_confirmed = p_condition_confirmed,
      updated_at = now()
  where id = p_pick_line_id
  returning * into v_line;

  if v_line.quantity_picked = v_line.quantity_to_pick then
    perform begin_inventory_pick(v_line.allocation_id);
    perform complete_inventory_pick(v_line.allocation_id);
  end if;

  return v_line;
end;
$$;

revoke execute on function record_pick_line_scan(uuid, text) from public, anon;
grant execute on function record_pick_line_scan(uuid, text) to authenticated;

-- begin_pick_batch(): now also moves every covered order from 'paid' to
-- 'picking'. Orders already past 'paid' (e.g. a second batch touching an
-- order that's somehow already picking) are left alone.
create or replace function begin_pick_batch(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch pick_batches;
begin
  select * into v_batch from pick_batches where id = p_batch_id;

  if v_batch is null then
    raise exception 'begin_pick_batch: unknown batch %', p_batch_id;
  end if;

  if not staff_has_node_access(v_batch.fulfilment_node_id) then
    raise exception 'begin_pick_batch: access denied for fulfilment node %', v_batch.fulfilment_node_id
      using errcode = '42501';
  end if;

  if v_batch.status <> 'pending' then
    raise exception 'begin_pick_batch: batch % is %, not pending', p_batch_id, v_batch.status;
  end if;

  update pick_batches
  set status = 'in_progress', started_at = now(), updated_at = now()
  where id = p_batch_id;

  update orders
  set status = 'picking', updated_at = now()
  where id in (select orders_for_pick_batch(p_batch_id))
    and status = 'paid';
end;
$$;

revoke execute on function begin_pick_batch(uuid) from public, anon;
grant execute on function begin_pick_batch(uuid) to authenticated;

-- complete_pick_batch(): now refuses to complete a batch with any
-- not-yet-fully-picked line, closing the gap where a batch could be marked
-- "completed" (and thus surfaced on the packing page as ready to pack)
-- while it still held unpicked stock.
create or replace function complete_pick_batch(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch pick_batches;
begin
  select * into v_batch from pick_batches where id = p_batch_id;

  if v_batch is null then
    raise exception 'complete_pick_batch: unknown batch %', p_batch_id;
  end if;

  if not staff_has_node_access(v_batch.fulfilment_node_id) then
    raise exception 'complete_pick_batch: access denied for fulfilment node %', v_batch.fulfilment_node_id
      using errcode = '42501';
  end if;

  if v_batch.status <> 'in_progress' then
    raise exception 'complete_pick_batch: batch % is %, not in_progress', p_batch_id, v_batch.status;
  end if;

  if exists (
    select 1 from pick_lines
    where pick_batch_id = p_batch_id and quantity_picked < quantity_to_pick
  ) then
    raise exception 'complete_pick_batch: batch % still has unpicked lines', p_batch_id;
  end if;

  update pick_batches
  set status = 'completed', completed_at = now(), completed_by_user_id = auth.uid(), updated_at = now()
  where id = p_batch_id;
end;
$$;

revoke execute on function complete_pick_batch(uuid) from public, anon;
grant execute on function complete_pick_batch(uuid) to authenticated;

-- create_shipment(): now requires the batch to actually be completed
-- (previously a shipment could be created for a batch still in_progress,
-- with nothing backing the "packed" label), and moves every covered order
-- from 'picking' to 'packed'.
create or replace function create_shipment(
  p_pick_batch_id uuid,
  p_carrier_code text default null
)
returns packing_shipments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch pick_batches;
  v_shipment packing_shipments;
  v_carrier_id uuid;
  v_org_id uuid;
begin
  select * into v_batch from pick_batches where id = p_pick_batch_id;
  if v_batch is null then
    raise exception 'create_shipment: unknown batch %', p_pick_batch_id;
  end if;

  if not staff_has_node_access(v_batch.fulfilment_node_id) then
    raise exception 'create_shipment: access denied for fulfilment node %', v_batch.fulfilment_node_id
      using errcode = '42501';
  end if;

  if v_batch.status <> 'completed' then
    raise exception 'create_shipment: batch % is %, not completed -- cannot pack an unfinished pick', p_pick_batch_id, v_batch.status;
  end if;

  select organisation_id into v_org_id from fulfilment_nodes where id = v_batch.fulfilment_node_id;

  if p_carrier_code is not null then
    select id into v_carrier_id from shipment_carriers where code = p_carrier_code;
    if v_carrier_id is null then
      raise exception 'create_shipment: unknown carrier %', p_carrier_code;
    end if;
  end if;

  insert into packing_shipments (
    organisation_id, pick_batch_id, carrier_id, packed_by_user_id, packed_at
  ) values (
    v_org_id, p_pick_batch_id, v_carrier_id, auth.uid(), now()
  )
  returning * into v_shipment;

  update orders
  set status = 'packed', updated_at = now()
  where id in (select orders_for_pick_batch(p_pick_batch_id))
    and status = 'picking';

  return v_shipment;
end;
$$;

revoke execute on function create_shipment(uuid, text) from public, anon;
grant execute on function create_shipment(uuid, text) to authenticated;

-- generate_shipment_label(): now moves every order covered by the
-- shipment's batch from 'packed' to 'dispatched' -- a label means this
-- parcel is ready to hand to the carrier, which is exactly what
-- orders.status's 'dispatched' step is meant to represent (previously
-- unused by any function).
create or replace function generate_shipment_label(
  p_shipment_id uuid,
  p_tracking_number text default null,
  p_label_url text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shipment packing_shipments;
  v_batch pick_batches;
begin
  select * into v_shipment from packing_shipments where id = p_shipment_id;
  if v_shipment is null then
    raise exception 'generate_shipment_label: unknown shipment %', p_shipment_id;
  end if;

  select * into v_batch from pick_batches where id = v_shipment.pick_batch_id;

  if not staff_has_node_access(v_batch.fulfilment_node_id) then
    raise exception 'generate_shipment_label: access denied for shipment %', p_shipment_id
      using errcode = '42501';
  end if;

  update packing_shipments
  set
    status = 'labeled',
    tracking_number = p_tracking_number,
    label_url = p_label_url,
    updated_at = now()
  where id = p_shipment_id;

  update orders
  set status = 'dispatched', updated_at = now()
  where id in (select orders_for_pick_batch(v_batch.id))
    and status = 'packed';
end;
$$;

revoke execute on function generate_shipment_label(uuid, text, text) from public, anon;
grant execute on function generate_shipment_label(uuid, text, text) to authenticated;

-- mark_shipment_shipped(): the one point where the customer actually finds
-- out their order shipped. Moves every covered order from 'dispatched' to
-- 'shipped', and -- previously missing entirely -- writes the
-- customer-facing `shipments` table (orders_and_shipments_v2,
-- distinct from packing_shipments, see that migration's reconciliation
-- note) so account order-tracking pages have a tracking number/carrier to
-- show. One row per covered order, carrying this parcel's carrier code and
-- tracking number; upserted on order_id so re-running this (e.g. retrying
-- after a partial failure) doesn't create duplicates.
create or replace function mark_shipment_shipped(p_shipment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shipment packing_shipments;
  v_batch pick_batches;
  v_carrier_code text;
  v_order_id uuid;
begin
  select * into v_shipment from packing_shipments where id = p_shipment_id;
  if v_shipment is null then
    raise exception 'mark_shipment_shipped: unknown shipment %', p_shipment_id;
  end if;

  select * into v_batch from pick_batches where id = v_shipment.pick_batch_id;

  if not staff_has_node_access(v_batch.fulfilment_node_id) then
    raise exception 'mark_shipment_shipped: access denied for shipment %', p_shipment_id
      using errcode = '42501';
  end if;

  update packing_shipments
  set status = 'shipped', shipped_at = now(), updated_at = now()
  where id = p_shipment_id;

  select code into v_carrier_code from shipment_carriers where id = v_shipment.carrier_id;

  for v_order_id in select orders_for_pick_batch(v_batch.id)
  loop
    if exists (select 1 from shipments where order_id = v_order_id) then
      update shipments
      set tracking_number = v_shipment.tracking_number,
          carrier = v_carrier_code,
          carrier_status = 'shipped',
          shipped_at = now(),
          updated_at = now()
      where order_id = v_order_id;
    else
      insert into shipments (order_id, tracking_number, carrier, carrier_status, shipped_at)
      values (v_order_id, v_shipment.tracking_number, v_carrier_code, 'shipped', now());
    end if;

    update orders
    set status = 'shipped', updated_at = now()
    where id = v_order_id and status = 'dispatched';
  end loop;
end;
$$;

revoke execute on function mark_shipment_shipped(uuid) from public, anon;
grant execute on function mark_shipment_shipped(uuid) to authenticated;
