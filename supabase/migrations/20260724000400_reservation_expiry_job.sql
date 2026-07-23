-- Reservation expiry scheduled job (Phase 2, B-112).
-- Runs periodically to release expired reservations and free up inventory (blueprint §10).

-- Enable pg_cron extension for scheduled jobs
create extension if not exists pg_cron;

-- Scheduled job: release expired reservations every 5 minutes
select cron.schedule(
  'release-expired-reservations',
  '*/5 * * * *',
  $$
  select release_expired_reservations();
  $$
);

-- Function to release all expired reservations
create or replace function release_expired_reservations()
returns json as $$
declare
  v_released_count integer := 0;
  v_reservation record;
  v_now timestamptz := now();
begin
  -- Find all active reservations that have expired (>15 minutes old)
  for v_reservation in (
    select id, sellable_sku_id, quantity
    from inventory_reservations
    where status = 'active'
      and created_at < v_now - interval '15 minutes'
  ) loop
    -- Release the reservation
    perform release_inventory_reservation(v_reservation.id);
    v_released_count := v_released_count + 1;
  end loop;

  -- Emit integration event for tracking
  if v_released_count > 0 then
    insert into integration_events (aggregate_id, aggregate_type, event_type, event_data)
    values (
      gen_random_uuid(),
      'reservation',
      'batch_reservations_expired',
      jsonb_build_object(
        'released_count', v_released_count,
        'released_at', v_now
      )
    );
  end if;

  return jsonb_build_object(
    'status', 'completed',
    'released_count', v_released_count,
    'released_at', v_now
  );
end;
$$ language plpgsql security definer;
