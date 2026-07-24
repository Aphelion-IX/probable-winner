-- Customer profile and addresses (blueprint §8.8, backlog Step 18 / B-170).
-- `profiles` extends auth.users (one row per customer, created automatically
-- on signup); `customer_addresses` holds their saved delivery addresses.
-- Neither table stores anything payment- or credential-related — see
-- store_credit_accounts (§8.9) for balances, which this task does not touch.

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  phone text,
  preferred_fulfilment_node_id uuid references fulfilment_nodes(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table customer_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  label text,
  line1 text not null,
  line2 text,
  city text not null,
  region text,
  postal_code text,
  country text not null default 'AU',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index customer_addresses_customer_idx on customer_addresses (customer_id);

-- RLS: a customer may only ever see or change their own profile/addresses.
alter table profiles enable row level security;
alter table customer_addresses enable row level security;

create policy profiles_select on profiles
  for select to authenticated
  using (id = auth.uid());

create policy profiles_update on profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- No insert policy: rows are created only by handle_new_customer() below, on
-- signup, via a security-definer trigger — never directly by the client.

create policy customer_addresses_select on customer_addresses
  for select to authenticated
  using (customer_id = auth.uid());

create policy customer_addresses_insert on customer_addresses
  for insert to authenticated
  with check (customer_id = auth.uid());

create policy customer_addresses_update on customer_addresses
  for update to authenticated
  using (customer_id = auth.uid())
  with check (customer_id = auth.uid());

create policy customer_addresses_delete on customer_addresses
  for delete to authenticated
  using (customer_id = auth.uid());

-- Auto-create a blank profile row when a new auth user signs up, so the app
-- never has to special-case "no profile yet" -- every authenticated user has
-- exactly one profiles row from the moment their account exists.
create or replace function handle_new_customer()
returns trigger as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_customer();

-- The storefront needs to show customers the list of active stores (for the
-- preferred-store field here, and for click-and-collect elsewhere) but
-- fulfilment_nodes previously had only a staff-scoped policy
-- (staff_has_node_access, 20260722082907_rls_policies_org_store_scope.sql).
-- Per AGENTS.md rule 4, add a narrower public policy rather than loosening
-- the staff one -- same shape as published_prices_select_public
-- (20260724170000_published_prices_public_read.sql): only active stores,
-- nothing about inactive/closed locations leaks to customers.
create policy fulfilment_nodes_select_public on fulfilment_nodes
  for select to anon, authenticated
  using (active = true);
