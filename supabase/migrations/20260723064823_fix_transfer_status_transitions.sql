-- RECONCILIATION NOTE: this migration exists on the live Supabase project
-- (probable-winner, lbsxsptpyhypuheuosye) but was never committed as a local
-- migration file until now. Content below is pulled verbatim from
-- supabase_migrations.schema_migrations on the live project so local
-- history matches what's actually deployed. See docs/deployment.md for the
-- reconciliation this and the following migrations are part of.

create or replace function enforce_transfer_status_transition()
returns trigger
language plpgsql
as $$
declare
  v_allowed boolean;
begin
  if new.status = old.status then
    return new;
  end if;

  v_allowed := (old.status, new.status) in (
    ('draft', 'requested'), ('draft', 'cancelled'),
    ('requested', 'accepted'), ('requested', 'cancelled'),
    ('accepted', 'picking'), ('accepted', 'cancelled'),
    ('picking', 'dispatched'), ('picking', 'cancelled'),
    ('dispatched', 'in_transit'),
    ('dispatched', 'partially_received'), ('dispatched', 'received'),
    ('in_transit', 'partially_received'), ('in_transit', 'received'),
    ('partially_received', 'partially_received'),
    ('partially_received', 'received')
  );

  if not v_allowed then
    raise exception 'transfer_orders: invalid status transition % -> %', old.status, new.status
      using errcode = '23514';
  end if;

  return new;
end;
$$;
