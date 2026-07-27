-- Shipment notification emails. mark_shipment_shipped() (most recently
-- redefined by 20260726060000_wire_up_picking_packing_shipment_workflow.sql)
-- already writes the customer-facing shipments table (tracking_number,
-- carrier) and flips orders.status to 'shipped', but nothing ever told the
-- customer their order shipped -- this is the second, and for now final,
-- concrete use of the "email" queue (order confirmation being the first,
-- 20260727060000_order_confirmation_email.sql).
--
-- Real carrier API integration (label generation/tracking via Australia
-- Post or another provider, per docs/architecture.md's stack table) is
-- explicitly not attempted here: it requires a real, provider-specific
-- business account this environment has no credentials for, and guessing
-- at one provider's API shape without anything to verify it against would
-- be worse than not building it. Staff still enter the tracking
-- number/label manually (generate_shipment_label(), unchanged) -- this
-- migration only adds the notification once that manually-entered
-- shipment is marked shipped.

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

  if p_event_type = 'inventory_balance_changed' then
    perform pgmq.send('restock_alerts', jsonb_build_object(
      'checkType', 'restock',
      'integrationEventId', v_event_id,
      'sellableSkuId', p_payload ->> 'sellableSkuId'
    ));
  elsif p_event_type = 'pricing_published' then
    perform pgmq.send('restock_alerts', jsonb_build_object(
      'checkType', 'price',
      'integrationEventId', v_event_id,
      'sellableSkuId', p_payload ->> 'sellableSkuId',
      'finalAmount', (p_payload ->> 'finalAmount')::numeric,
      'currency', p_payload ->> 'currency'
    ));
  elsif p_event_type = 'order_paid' then
    perform pgmq.send('email', jsonb_build_object(
      'emailType', 'order_confirmation',
      'integrationEventId', v_event_id,
      'orderId', p_aggregate_id
    ));
  elsif p_event_type = 'order_shipped' then
    perform pgmq.send('email', jsonb_build_object(
      'emailType', 'shipment_notification',
      'integrationEventId', v_event_id,
      'orderId', p_aggregate_id
    ));
  end if;

  return v_event_id;
end;
$$;

revoke execute on function emit_integration_event(uuid, text, text, uuid, jsonb) from public, anon, authenticated;

-- Reproduced from 20260726060000_wire_up_picking_packing_shipment_workflow.sql
-- (current definition, same signature -- no DROP needed) with one
-- addition: emitting an order_shipped event, only for an order whose
-- status the update above actually flipped to 'shipped' (guarded by
-- FOUND, set by that UPDATE) -- an order already shipped or not yet
-- dispatched must not get a duplicate/premature notification.
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
  v_organisation_id uuid;
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

  select organisation_id into v_organisation_id from fulfilment_nodes where id = v_batch.fulfilment_node_id;

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

    if found then
      perform emit_integration_event(
        v_organisation_id, 'order_shipped', 'order', v_order_id,
        jsonb_build_object(
          'orderId', v_order_id,
          'trackingNumber', v_shipment.tracking_number,
          'carrier', v_carrier_code,
          'shippedAt', now()
        )
      );
    end if;
  end loop;
end;
$$;

revoke execute on function mark_shipment_shipped(uuid) from public, anon;
grant execute on function mark_shipment_shipped(uuid) to authenticated;
