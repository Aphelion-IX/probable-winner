-- Fixes two further bugs in confirm_order_payment()/release_failed_order_reservations()
-- found by the 2026-07-26 security re-audit (item 4), on top of the column-
-- name/argument-count fixes already applied by
-- 20260724160000_fix_checkout_payment_confirmation.sql:
--
-- 1. Both functions still declared their parameter as bare `order_id`, then
--    wrote `where ol.order_id = order_id` (or `cl.reservation_id`/etc.) --
--    order_lines has a column literally named order_id, so that unqualified
--    reference is ambiguous between the plpgsql parameter and the column.
--    plpgsql's default variable_conflict = 'error' means this doesn't
--    silently resolve to the wrong thing (unlike the LANGUAGE SQL bug fixed
--    in 20260725210000_fix_order_function_parameter_shadowing.sql) -- it
--    raises an error on every call, so payment confirmation has never
--    actually completed. Renamed to p_order_id/p_stripe_event_id, the same
--    fix already applied to get_order_allocations()/customer_has_orders().
--
-- 2. Both functions joined order_lines back to cart_lines by
--    sellable_sku_id alone to find "the" reservation for a line -- flagged
--    explicitly as a known limitation in that migration's own comment,
--    because if more than one active cart holds a reservation for the same
--    SKU, this can convert or release the wrong customer's stock.
--    order_lines.inventory_reservation_id (added by
--    20260726040000_atomic_pending_order_creation.sql, and populated by
--    create_pending_order() for every line going forward) now records
--    exactly which reservation this line came from, so both functions read
--    it directly and never touch cart_lines at all.
--
-- Also inlines the reservation -> allocation conversion here rather than
-- calling allocate_order_inventory() (20260723060956): that function gates
-- on staff_has_node_access(), which reads auth.uid() from the request JWT --
-- meaningless for the service-role Stripe webhook this function is called
-- from (service_role has no auth.uid()), so every call would have failed
-- that check even after fix #1 above. confirm_order_payment()'s own trust
-- boundary is its EXECUTE grant (service_role only, set by
-- 20260725040000_lock_down_backend_only_functions.sql) -- the same "grant
-- is the boundary, not a staff check" shape reserve_inventory() already
-- uses for its customer-facing counterpart.
--
-- DROP + CREATE (not CREATE OR REPLACE): renaming a parameter requires it,
-- per Postgres (see 20260725210000's comment for the same reasoning). Their
-- EXECUTE grants (service_role only) must be re-applied after CREATE, since
-- DROP FUNCTION discards them.

drop function if exists confirm_order_payment(uuid, text);

create function confirm_order_payment(
  p_order_id uuid,
  p_stripe_event_id text
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

  -- Emit integration event for downstream triggers (picking job, etc.).
  insert into integration_events (organisation_id, aggregate_id, aggregate_type, event_type, payload)
    values (
      v_order.organisation_id,
      p_order_id,
      'order',
      'order_paid',
      jsonb_build_object(
        'order_id', p_order_id,
        'stripe_event_id', p_stripe_event_id,
        'allocation_count', v_allocation_count,
        'paid_at', now()
      )
    );

  return jsonb_build_object(
    'status', 'confirmed',
    'order_id', p_order_id,
    'allocations_created', v_allocation_count
  );
end;
$$;

revoke execute on function confirm_order_payment(uuid, text) from public, anon, authenticated;
grant execute on function confirm_order_payment(uuid, text) to service_role;

drop function if exists release_failed_order_reservations(uuid);

create function release_failed_order_reservations(
  p_order_id uuid
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_released_count integer := 0;
  v_line record;
begin
  select * into v_order from orders where id = p_order_id for update;
  if v_order is null then
    raise exception 'order not found: %', p_order_id;
  end if;

  if v_order.status not in ('pending', 'cancelled') then
    raise exception 'cannot release reservations for order in status: %', v_order.status;
  end if;

  for v_line in (
    select ol.inventory_reservation_id as reservation_id
    from order_lines ol
    where ol.order_id = p_order_id and ol.inventory_reservation_id is not null
  ) loop
    perform release_inventory_reservation(v_line.reservation_id);
    v_released_count := v_released_count + 1;
  end loop;

  -- Mark order as cancelled if it's still pending.
  if v_order.status = 'pending' then
    update orders
      set status = 'cancelled', updated_at = now()
      where id = p_order_id;
  end if;

  -- Emit event for audit trail.
  insert into integration_events (organisation_id, aggregate_id, aggregate_type, event_type, payload)
    values (
      v_order.organisation_id,
      p_order_id,
      'order',
      'order_reservations_released',
      jsonb_build_object(
        'order_id', p_order_id,
        'reason', 'payment_failed_or_session_expired',
        'released_count', v_released_count
      )
    );

  return jsonb_build_object(
    'status', 'reservations_released',
    'order_id', p_order_id,
    'released_count', v_released_count
  );
end;
$$;

revoke execute on function release_failed_order_reservations(uuid) from public, anon, authenticated;
grant execute on function release_failed_order_reservations(uuid) to service_role;
