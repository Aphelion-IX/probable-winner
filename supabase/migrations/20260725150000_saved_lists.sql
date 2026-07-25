-- Customer saved lists (backlog B-172, Phase 4 demand tools). Lets a
-- customer add exact SKUs (printing + finish + condition + language, the
-- same identity add-to-cart uses) for later purchase, same spirit as
-- price_alerts/restock_alerts (20260724130000_customer_alerts.sql) but for
-- "I want this, not necessarily right now" rather than a price/stock
-- trigger. One implicit list per customer for now (get_or_create below) --
-- the plural table names leave room for named/multiple lists later without
-- a schema change, but nothing today asks for list management UI.

create table saved_lists (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'My Saved List',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index saved_lists_customer_idx on saved_lists (customer_id);

create table saved_list_lines (
  id uuid primary key default gen_random_uuid(),
  saved_list_id uuid not null references saved_lists(id) on delete cascade,
  sellable_sku_id uuid not null references sellable_skus(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (saved_list_id, sellable_sku_id)
);

create index saved_list_lines_list_idx on saved_list_lines (saved_list_id);
create index saved_list_lines_sku_idx on saved_list_lines (sellable_sku_id);

-- RLS: customers see/manage only their own list(s).
alter table saved_lists enable row level security;
alter table saved_list_lines enable row level security;

create policy saved_lists_select on saved_lists
  for select to authenticated
  using (customer_id = (select auth.uid()));

create policy saved_lists_insert on saved_lists
  for insert to authenticated
  with check (customer_id = (select auth.uid()));

create policy saved_list_lines_select on saved_list_lines
  for select to authenticated
  using (
    exists (
      select 1 from saved_lists sl
      where sl.id = saved_list_lines.saved_list_id
        and sl.customer_id = (select auth.uid())
    )
  );

create policy saved_list_lines_insert on saved_list_lines
  for insert to authenticated
  with check (
    exists (
      select 1 from saved_lists sl
      where sl.id = saved_list_lines.saved_list_id
        and sl.customer_id = (select auth.uid())
    )
  );

create policy saved_list_lines_delete on saved_list_lines
  for delete to authenticated
  using (
    exists (
      select 1 from saved_lists sl
      where sl.id = saved_list_lines.saved_list_id
        and sl.customer_id = (select auth.uid())
    )
  );

-- Helper: the current customer's implicit saved list, creating it on first use.
create or replace function get_or_create_saved_list()
returns uuid as $$
declare
  v_list_id uuid;
begin
  select id into v_list_id from saved_lists where customer_id = auth.uid() limit 1;

  if v_list_id is null then
    insert into saved_lists (customer_id) values (auth.uid()) returning id into v_list_id;
  end if;

  return v_list_id;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function get_or_create_saved_list() from public, anon;
grant execute on function get_or_create_saved_list() to authenticated;

-- Helper: add a SKU to the current customer's saved list (idempotent).
create or replace function add_to_saved_list(p_sellable_sku_id uuid)
returns uuid as $$
declare
  v_list_id uuid;
  v_line_id uuid;
begin
  v_list_id := get_or_create_saved_list();

  insert into saved_list_lines (saved_list_id, sellable_sku_id)
  values (v_list_id, p_sellable_sku_id)
  on conflict (saved_list_id, sellable_sku_id) do update
  set saved_list_id = excluded.saved_list_id
  returning id into v_line_id;

  return v_line_id;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function add_to_saved_list(uuid) from public, anon;
grant execute on function add_to_saved_list(uuid) to authenticated;

-- Helper: remove a SKU from the current customer's saved list. A no-op
-- (not an error) if it was never saved or already removed, same
-- idempotency stance as release_inventory_reservation().
create or replace function remove_from_saved_list(p_sellable_sku_id uuid)
returns void as $$
begin
  delete from saved_list_lines sll
  using saved_lists sl
  where sll.saved_list_id = sl.id
    and sl.customer_id = auth.uid()
    and sll.sellable_sku_id = p_sellable_sku_id;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function remove_from_saved_list(uuid) from public, anon;
grant execute on function remove_from_saved_list(uuid) to authenticated;
