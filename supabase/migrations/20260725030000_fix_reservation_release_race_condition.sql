-- Fixes a check-then-lock race in release_inventory_reservation() that has
-- been driving inventory_balances.quantity_reserved negative in production
-- (ERROR: inventory_balances_quantity_reserved_check, firing on essentially
-- every run of the release-expired-reservations cron job -- see
-- 20260723070907_reservation_expiry.sql for that job).
--
-- The bug: release_inventory_reservation() read the reservation and checked
-- `status <> 'active'` *before* calling lock_inventory_balance() (a
-- `SELECT ... FOR UPDATE` on inventory_balances). Two concurrent callers
-- releasing the same reservation -- e.g. an overlapping cron run and a
-- customer action, or two overlapping cron runs once the expired-reservation
-- backlog got large enough that a single run stopped finishing inside a
-- minute -- could both pass the active-status check, then serialize on the
-- balance lock, and both decrement quantity_reserved by the same amount.
-- allocate_order_inventory() has the identical pattern (reservation status
-- checked before the balance lock is acquired) and the same fix applies.
--
-- Fix: lock the reservation row itself first (`SELECT ... FOR UPDATE`) so a
-- second concurrent caller blocks until the first commits, then re-reads the
-- row and sees the now-terminal status instead of a stale 'active' one.

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

  -- No-op for an already-terminal reservation (active is the only status
  -- that still holds stock) -- calling release twice, or releasing an
  -- expired/cancelled/converted reservation, must not double-release. The
  -- row lock above (not just this check) is what makes that guarantee hold
  -- under concurrent callers, not just sequential ones.
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

  return v_allocation;
end;
$$;

-- Harden the expiry sweep itself: it used to run as one giant transaction
-- with no per-row error isolation, so the first reservation whose release
-- failed (for any reason, not just this race) rolled back the entire batch
-- -- every single run, forever, with the backlog never shrinking. Add
-- per-row exception handling (a failure gets logged and skipped, not
-- retried into the same wall every minute), an advisory lock so overlapping
-- cron runs don't step on each other while a large backlog is being worked
-- through, and a batch limit so one run can't hold the advisory lock
-- indefinitely.
create or replace function release_expired_reservations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reservation_id uuid;
  v_count integer := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('release_expired_reservations')) then
    -- A previous run is still in flight; skip this tick rather than race it.
    return 0;
  end if;

  for v_reservation_id in
    select id from inventory_reservations
    where status = 'active' and expires_at < now()
    order by expires_at
    limit 500
  loop
    begin
      perform release_inventory_reservation(v_reservation_id);
      v_count := v_count + 1;
    exception when others then
      raise warning 'release_expired_reservations: failed to release reservation %: %', v_reservation_id, sqlerrm;
    end;
  end loop;

  return v_count;
end;
$$;

revoke execute on function release_expired_reservations() from public, anon, authenticated;
