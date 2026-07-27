-- Order confirmation emails. The "email" and "order_processing" pgmq
-- queues (migration 20260722120349) have sat empty since they were
-- created -- nothing anywhere ever wrote a message to either, so a paid
-- order has never triggered any customer-facing confirmation. This wires
-- up the "email" queue specifically for that one well-defined case.
--
-- confirm_order_payment() (most recently redefined by
-- 20260726050000_fix_payment_confirmation_reservation_matching.sql) wrote
-- its order_paid integration_events row directly instead of through
-- emit_integration_event(), same pre-existing pattern already fixed for
-- pricing in 20260727030000_fix_pricing_publish_search_index_sync.sql. It
-- now routes through emit_integration_event(), which gains an 'order_paid'
-- branch alongside its existing 'inventory_balance_changed'/
-- 'pricing_published' ones.
--
-- A guest order has no auth.users row to read an email from, and nothing
-- in checkout today collects one -- but Stripe's own hosted Checkout page
-- always collects the buyer's email regardless, so confirm_order_payment()
-- now accepts it optionally (populated from the webhook's
-- session.customer_details.email) and stores it on the order only when the
-- order has no customer_id and doesn't already have one. An authenticated
-- customer's confirmation always uses their real account email, never
-- this parameter, since guest_email is only ever set on a still-null
-- column for a guest order.

alter table orders add column if not exists guest_email text;

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
  end if;

  return v_event_id;
end;
$$;

revoke execute on function emit_integration_event(uuid, text, text, uuid, jsonb) from public, anon, authenticated;

-- Reproduced from 20260726050000_fix_payment_confirmation_reservation_matching.sql
-- (current definition) with two additions: an optional trailing
-- p_guest_email parameter, and routing the order_paid event through
-- emit_integration_event() instead of a raw insert. Every other line,
-- including the idempotency check and the reservation -> allocation
-- conversion, is unchanged.
--
-- DROP + CREATE, not CREATE OR REPLACE: adding a parameter changes the
-- function's argument-type identity even with a default, so CREATE OR
-- REPLACE would create a second, additional (uuid, text, text) overload
-- alongside the existing (uuid, text) one rather than replacing it --
-- same reasoning as 20260726030000_lock_down_inventory_and_guest_cart_rpcs.sql's
-- comment for add_to_cart()/update_cart_line_quantity()/etc. The EXECUTE
-- grant is re-applied below since DROP FUNCTION discards it.
drop function if exists confirm_order_payment(uuid, text);

create function confirm_order_payment(
  p_order_id uuid,
  p_stripe_event_id text,
  p_guest_email text default null
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_event_exists boolean;
  v_allocation_count integer := 0;
  v_line record;
  v_reservation inventory_reservations;
  v_allocation inventory_allocations;
begin
  -- Idempotency: if this stripe_event_id was already processed, return success without repeating.
  select id is not null into v_event_exists from stripe_events where id = p_stripe_event_id;
  if v_event_exists then
    return jsonb_build_object(
      'status', 'already_processed',
      'order_id', p_order_id,
      'message', 'This Stripe event was already processed'
    );
  end if;

  select * into v_order from orders where id = p_order_id for update;
  if v_order is null then
    raise exception 'order not found: %', p_order_id;
  end if;

  if v_order.status != 'pending' then
    raise exception 'order is not pending, current status: %', v_order.status;
  end if;

  -- Store the Stripe event (first, before side effects, so replay is safe).
  insert into stripe_events (id, event_type, event_data, order_id)
  values (p_stripe_event_id, 'payment_intent.succeeded',
          jsonb_build_object('order_id', p_order_id), p_order_id);

  -- Capture the buyer's email for a guest order (Stripe's own hosted
  -- Checkout page always collects one) -- only when there's no customer_id
  -- to look one up from and nothing already captured, so this never
  -- overwrites a real value on any later call for this same order.
  if v_order.customer_id is null and v_order.guest_email is null and p_guest_email is not null then
    update orders set guest_email = p_guest_email, updated_at = now() where id = p_order_id;
  end if;

  -- Convert each order line's own reservation into an allocation -- exact,
  -- not matched by SKU across whatever carts happen to exist.
  for v_line in (
    select ol.id as line_id, ol.inventory_reservation_id as reservation_id
    from order_lines ol
    where ol.order_id = p_order_id
  ) loop
    if v_line.reservation_id is null then
      raise exception 'confirm_order_payment: order line % has no linked reservation', v_line.line_id;
    end if;

    select * into v_reservation from inventory_reservations where id = v_line.reservation_id for update;
    if v_reservation is null or v_reservation.status <> 'active' then
      raise exception 'confirm_order_payment: reservation % for order line % is not active', v_line.reservation_id, v_line.line_id;
    end if;

    perform lock_inventory_balance(v_reservation.fulfilment_node_id, v_reservation.sellable_sku_id);

    update inventory_balances
    set quantity_reserved = quantity_reserved - v_reservation.quantity,
        quantity_allocated = quantity_allocated + v_reservation.quantity,
        updated_at = now()
    where fulfilment_node_id = v_reservation.fulfilment_node_id and sellable_sku_id = v_reservation.sellable_sku_id;

    update inventory_reservations
    set status = 'converted', updated_at = now()
    where id = v_reservation.id;

    insert into inventory_allocations (
      organisation_id, fulfilment_node_id, sellable_sku_id, inventory_reservation_id, order_line_id, quantity
    ) values (
      v_reservation.organisation_id, v_reservation.fulfilment_node_id, v_reservation.sellable_sku_id,
      v_reservation.id, v_line.line_id, v_reservation.quantity
    )
    returning * into v_allocation;

    insert into inventory_movements (
      organisation_id, fulfilment_node_id, sellable_sku_id, movement_type,
      quantity_delta, reference_type, reference_id, staff_user_id
    ) values (
      v_reservation.organisation_id, v_reservation.fulfilment_node_id, v_reservation.sellable_sku_id,
      'allocate', v_reservation.quantity, 'inventory_allocation', v_allocation.id, null
    );

    v_allocation_count := v_allocation_count + 1;
  end loop;

  -- Update order status to 'paid'.
  update orders
    set status = 'paid', updated_at = now()
    where id = p_order_id;

  perform emit_integration_event(
    v_order.organisation_id, 'order_paid', 'order', p_order_id,
    jsonb_build_object(
      'orderId', p_order_id,
      'stripeEventId', p_stripe_event_id,
      'allocationCount', v_allocation_count,
      'paidAt', now()
    )
  );

  return jsonb_build_object(
    'status', 'confirmed',
    'order_id', p_order_id,
    'allocations_created', v_allocation_count
  );
end;
$$;

revoke execute on function confirm_order_payment(uuid, text, text) from public, anon, authenticated;
grant execute on function confirm_order_payment(uuid, text, text) to service_role;
