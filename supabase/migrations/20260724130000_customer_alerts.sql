-- Customer price and restock alerts (Phase 4 demand tools).
-- Customers can set alerts for cards they're interested in buying.

create table price_alerts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  card_printing_id uuid not null references card_printings(id) on delete cascade,
  finish text not null default 'normal' check (finish in ('normal', 'foil', 'etched')),
  alert_price numeric(12, 2) not null,
  currency text not null default 'AUD',
  status text not null default 'active' check (status in ('active', 'triggered', 'inactive')),
  triggered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index price_alerts_customer_idx on price_alerts (customer_id);
create index price_alerts_card_idx on price_alerts (card_printing_id);
create index price_alerts_status_idx on price_alerts (status);
-- Required by upsert_price_alert()'s ON CONFLICT (customer_id,
-- card_printing_id, finish) below -- without this constraint that upsert
-- fails with "no unique or exclusion constraint matching the ON CONFLICT
-- specification" on every call.
alter table price_alerts add constraint price_alerts_customer_card_finish_uq
  unique (customer_id, card_printing_id, finish);

create table restock_alerts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  card_printing_id uuid not null references card_printings(id) on delete cascade,
  finish text not null default 'normal' check (finish in ('normal', 'foil', 'etched')),
  condition text not null default 'NM',
  status text not null default 'active' check (status in ('active', 'triggered', 'inactive')),
  triggered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index restock_alerts_customer_idx on restock_alerts (customer_id);
create index restock_alerts_card_idx on restock_alerts (card_printing_id);
create index restock_alerts_status_idx on restock_alerts (status);
-- Required by upsert_restock_alert()'s ON CONFLICT (customer_id,
-- card_printing_id, finish, condition) below -- same reasoning as
-- price_alerts_customer_card_finish_uq above.
alter table restock_alerts add constraint restock_alerts_customer_card_finish_condition_uq
  unique (customer_id, card_printing_id, finish, condition);

-- RLS: customers see only their own alerts
alter table price_alerts enable row level security;
alter table restock_alerts enable row level security;

create policy price_alerts_select on price_alerts
  for select to authenticated
  using (customer_id = auth.uid());

create policy price_alerts_insert on price_alerts
  for insert to authenticated
  with check (customer_id = auth.uid());

create policy price_alerts_delete on price_alerts
  for delete to authenticated
  using (customer_id = auth.uid());

create policy restock_alerts_select on restock_alerts
  for select to authenticated
  using (customer_id = auth.uid());

create policy restock_alerts_insert on restock_alerts
  for insert to authenticated
  with check (customer_id = auth.uid());

create policy restock_alerts_delete on restock_alerts
  for delete to authenticated
  using (customer_id = auth.uid());

-- Helper: create or update price alert (upsert by customer/card/finish)
create or replace function upsert_price_alert(
  p_card_printing_id uuid,
  p_finish text,
  p_alert_price numeric,
  p_currency text
) returns uuid as $$
declare
  v_alert_id uuid;
begin
  insert into price_alerts (customer_id, card_printing_id, finish, alert_price, currency, status)
  values (auth.uid(), p_card_printing_id, p_finish, p_alert_price, p_currency, 'active')
  on conflict (customer_id, card_printing_id, finish) do update
  set alert_price = excluded.alert_price, currency = excluded.currency, status = 'active', updated_at = now()
  returning id into v_alert_id;
  return v_alert_id;
end;
$$ language plpgsql security definer;

revoke execute on function upsert_price_alert(uuid, text, numeric, text) from public, anon;
grant execute on function upsert_price_alert(uuid, text, numeric, text) to authenticated;

-- Helper: create or update restock alert
create or replace function upsert_restock_alert(
  p_card_printing_id uuid,
  p_finish text,
  p_condition text
) returns uuid as $$
declare
  v_alert_id uuid;
begin
  insert into restock_alerts (customer_id, card_printing_id, finish, condition, status)
  values (auth.uid(), p_card_printing_id, p_finish, p_condition, 'active')
  on conflict (customer_id, card_printing_id, finish, condition) do update
  set status = 'active', updated_at = now()
  returning id into v_alert_id;
  return v_alert_id;
end;
$$ language plpgsql security definer;

revoke execute on function upsert_restock_alert(uuid, text, text) from public, anon;
grant execute on function upsert_restock_alert(uuid, text, text) to authenticated;
