-- Reservation expiry (blueprint §10, backlog B-112). release_inventory_
-- reservation() has no staff gate at all (it's customer-facing, B-062), so
-- there's no trusted-connection consideration here the way adjust_inventory()
-- needed one for B-065's worker job -- this function is callable from
-- anywhere, cron included.
create extension if not exists pg_cron;

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
  for v_reservation_id in
    select id from inventory_reservations where status = 'active' and expires_at < now()
  loop
    perform release_inventory_reservation(v_reservation_id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function release_expired_reservations() from public, anon, authenticated;

select cron.schedule(
  'release-expired-reservations',
  '* * * * *',
  $$select release_expired_reservations()$$
);
