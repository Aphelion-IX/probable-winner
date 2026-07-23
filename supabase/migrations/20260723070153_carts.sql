-- carts/cart_lines (blueprint §8.7/§10, backlog Step 12 / B-110). A cart is
-- owned by exactly one of customer_id (logged in) or guest_token (a random
-- id the app stores in a signed cookie -- the signing/verification is
-- application-layer, this column just holds the identifier). Every
-- cart_line's quantity always matches its linked inventory_reservations
-- row's quantity exactly -- reservations are immutable in quantity
-- (reserve_inventory() has no "add more" operation), so any quantity
-- change on a line releases the old reservation and creates a fresh one
-- for the new quantity, rather than trying to mutate a reservation in
-- place.
--
-- No raw table RLS for anon/guest carts: PostgREST has no stable identity
-- for an unauthenticated guest to check a guest_token against without
-- exposing a read-any-cart-by-guessed-token hole. Guest cart access goes
-- entirely through the SECURITY DEFINER functions below, which take the
-- guest_token as an explicit argument -- the same shape reserve_inventory()
-- already uses for anon callers.

create table carts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  customer_id uuid references auth.users(id) on delete cascade,
  guest_token uuid unique,
  status text not null default 'active' check (status in ('active', 'merged', 'abandoned', 'converted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint carts_exactly_one_owner check (
    (customer_id is not null and guest_token is null) or (customer_id is null and guest_token is not null)
  )
);

-- One active cart per customer/guest -- partial unique indexes so a
-- merged/abandoned/converted cart doesn't block creating a new active one.
create unique index carts_active_customer_uq on carts (customer_id) where status = 'active' and customer_id is not null;
create unique index carts_active_guest_uq on carts (guest_token) where status = 'active' and guest_token is not null;

create table cart_lines (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references carts(id) on delete cascade,
  fulfilment_node_id uuid not null references fulfilment_nodes(id) on delete cascade,
  sellable_sku_id uuid not null references sellable_skus(id) on delete cascade,
  quantity integer not null check (quantity > 0),
  inventory_reservation_id uuid not null references inventory_reservations(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cart_id, fulfilment_node_id, sellable_sku_id)
);

create index cart_lines_cart_idx on cart_lines (cart_id);

alter table carts enable row level security;
alter table cart_lines enable row level security;

-- Authenticated customers can read their own cart directly (guest carts
-- are function-only, see above). No write policies -- all mutation goes
-- through the atomic functions below.
create policy carts_select_own on carts
  for select to authenticated
  using (customer_id = auth.uid());
create policy cart_lines_select_own on cart_lines
  for select to authenticated
  using (exists (select 1 from carts c where c.id = cart_lines.cart_id and c.customer_id = auth.uid()));
