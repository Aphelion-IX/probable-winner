-- Order payment confirmation and reservation-to-allocation conversion (Phase 2, B-125/B-126).
-- Implements the blueprint §16 payment sequence: webhook received → payment confirmed →
-- reservations converted to allocations → picking job created.

-- Mark order as paid (from Stripe webhook, idempotent).
-- Converts all associated reservations to allocations and emits integration event.
create or replace function confirm_order_payment(
  order_id uuid,
  stripe_event_id text
) returns json as $$
declare
  v_order record;
  v_event_exists boolean;
  v_allocation_count integer := 0;
  v_line record;
begin
  -- Idempotency: if this stripe_event_id was already processed, return success without repeating.
  select id is not null into v_event_exists from stripe_events where id = stripe_event_id;
  if v_event_exists then
    -- Event already processed; silently succeed per blueprint §16.
    return jsonb_build_object(
      'status', 'already_processed',
      'order_id', order_id,
      'message', 'This Stripe event was already processed'
    );
  end if;

  select * into v_order from orders where id = order_id for update;
  if v_order is null then
    raise exception 'order not found: %', order_id;
  end if;

  if v_order.status != 'pending' then
    raise exception 'order is not pending, current status: %', v_order.status;
  end if;

  -- Store the Stripe event (first, before side effects, so replay is safe).
  insert into stripe_events (id, event_type, event_data, order_id)
  values (stripe_event_id, 'payment_intent.succeeded',
          jsonb_build_object('order_id', order_id), order_id);

  -- Convert all reservations to allocations for this order's lines.
  for v_line in (
    select ol.id as line_id, cl.reservation_id, ol.sellable_sku_id, ol.quantity
    from order_lines ol
    join cart_lines cl on cl.sellable_sku_id = ol.sellable_sku_id
    where ol.order_id = order_id
  ) loop
    -- Call allocate_order_inventory() (from B-063) to convert reservation → allocation.
    -- This function validates the reservation, writes the allocation movement, and updates balance.
    perform allocate_order_inventory(v_line.reservation_id, v_line.sellable_sku_id, v_line.quantity);
    v_allocation_count := v_allocation_count + 1;
  end loop;

  -- Update order status to 'paid'.
  update orders
    set status = 'paid', updated_at = now()
    where id = order_id;

  -- Emit integration event for downstream triggers (picking job, etc.).
  insert into integration_events (aggregate_id, aggregate_type, event_type, event_data)
    values (
      order_id,
      'order',
      'order_paid',
      jsonb_build_object(
        'order_id', order_id,
        'stripe_event_id', stripe_event_id,
        'allocation_count', v_allocation_count,
        'paid_at', now()
      )
    );

  return jsonb_build_object(
    'status', 'confirmed',
    'order_id', order_id,
    'allocations_created', v_allocation_count
  );
end;
$$ language plpgsql security definer;

-- Handle failed/expired Stripe Checkout Session (blueprint §16: "failed/expired Checkout Session
-- releases the associated reservations rather than holding them until natural expiry").
-- Called when a Checkout Session expires or payment fails.
create or replace function release_failed_order_reservations(
  order_id uuid
) returns json as $$
declare
  v_order record;
  v_released_count integer := 0;
  v_line record;
begin
  select * into v_order from orders where id = order_id for update;
  if v_order is null then
    raise exception 'order not found: %', order_id;
  end if;

  if v_order.status not in ('pending', 'cancelled') then
    raise exception 'cannot release reservations for order in status: %', v_order.status;
  end if;

  -- Release all associated reservations.
  for v_line in (
    select cl.reservation_id
    from order_lines ol
    join cart_lines cl on cl.sellable_sku_id = ol.sellable_sku_id
    where ol.order_id = order_id and cl.reservation_id is not null
  ) loop
    if v_line.reservation_id is not null then
      perform release_inventory_reservation(v_line.reservation_id);
      v_released_count := v_released_count + 1;
    end if;
  end loop;

  -- Mark order as cancelled if it's still pending.
  if v_order.status = 'pending' then
    update orders
      set status = 'cancelled', updated_at = now()
      where id = order_id;
  end if;

  -- Emit event for audit trail.
  insert into integration_events (aggregate_id, aggregate_type, event_type, event_data)
    values (
      order_id,
      'order',
      'order_reservations_released',
      jsonb_build_object(
        'order_id', order_id,
        'reason', 'payment_failed_or_session_expired',
        'released_count', v_released_count
      )
    );

  return jsonb_build_object(
    'status', 'reservations_released',
    'order_id', order_id,
    'released_count', v_released_count
  );
end;
$$ language plpgsql security definer;
