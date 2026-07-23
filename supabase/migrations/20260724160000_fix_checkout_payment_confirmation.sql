-- Fixes three bugs discovered while reconciling this repo's local
-- migrations against the live Supabase project (see the RECONCILIATION
-- NOTE comments in 20260723064823_fix_transfer_status_transitions.sql
-- onward): confirm_order_payment() and release_failed_order_reservations()
-- (20260723081608_order_payment_and_allocation.sql) have never worked --
-- every call throws before completing -- which means payment confirmation,
-- the function a Stripe webhook handler would call per AGENTS.md rule 10,
-- has been broken since it was first applied live.
--
-- 1. cart_lines.reservation_id does not exist -- the real column
--    (20260723070153_carts.sql) is inventory_reservation_id.
-- 2. confirm_order_payment() calls allocate_order_inventory() with 3
--    positional args (reservation_id, sellable_sku_id, quantity); its real
--    signature (20260723060956_allocate_and_pick_inventory.sql) is
--    (p_reservation_id uuid, p_order_line_id uuid default null) -- 2 args,
--    and the second one means something different (the order_line_id, not
--    a quantity).
-- 3. Both functions insert into integration_events using a column named
--    event_data and omit organisation_id; the real table
--    (20260723065043_integration_events_outbox.sql) has payload (not
--    event_data) and requires organisation_id. Same bug pattern already
--    fixed for the pricing approval functions in
--    20260724140000_audit_events.sql.
--
-- Not fixed here: order_lines has no column linking a line back to the
-- reservation/cart_line it came from, so both functions join cart_lines to
-- order_lines by sellable_sku_id alone -- if more than one active cart
-- holds a reservation for the same SKU, this can match the wrong
-- reservation. That's a data-model gap (order_lines needs a
-- reservation/cart_line reference), not a column-name typo, and fixing it
-- properly is a product/schema decision beyond this hardening pass -- left
-- as a flagged, known limitation.

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
    select ol.id as line_id, cl.inventory_reservation_id as reservation_id, ol.sellable_sku_id, ol.quantity
    from order_lines ol
    join cart_lines cl on cl.sellable_sku_id = ol.sellable_sku_id
    where ol.order_id = order_id
  ) loop
    -- Call allocate_order_inventory() (from B-063) to convert reservation → allocation.
    -- This function validates the reservation, writes the allocation movement, and updates balance.
    perform allocate_order_inventory(v_line.reservation_id, v_line.line_id);
    v_allocation_count := v_allocation_count + 1;
  end loop;

  -- Update order status to 'paid'.
  update orders
    set status = 'paid', updated_at = now()
    where id = order_id;

  -- Emit integration event for downstream triggers (picking job, etc.).
  insert into integration_events (organisation_id, aggregate_id, aggregate_type, event_type, payload)
    values (
      v_order.organisation_id,
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
    select cl.inventory_reservation_id as reservation_id
    from order_lines ol
    join cart_lines cl on cl.sellable_sku_id = ol.sellable_sku_id
    where ol.order_id = order_id and cl.inventory_reservation_id is not null
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
  insert into integration_events (organisation_id, aggregate_id, aggregate_type, event_type, payload)
    values (
      v_order.organisation_id,
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
