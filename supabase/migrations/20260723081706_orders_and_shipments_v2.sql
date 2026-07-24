-- RECONCILIATION NOTE: pulled verbatim from the live project's migration
-- history (see 20260723064823_fix_transfer_status_transitions.sql for why).
-- validate_checkout() references published_prices, which does not exist
-- until 20260723082400_published_prices_and_overrides.sql (a migration
-- this reconciliation also brings into the local chain, positioned after
-- this one) -- fine at CREATE FUNCTION time since plpgsql bodies aren't
-- validated against schema until executed, and matches how this actually
-- applied live.

-- Orders and shipments schema (Phase 2, Step 13: Checkout and Payments).
-- Core order lifecycle from pending → paid → picking → packed → dispatched → shipped → delivered.
-- See docs/business-rules.md for full status diagram and allowed transitions.

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  customer_id uuid references auth.users(id) on delete cascade,
  fulfilment_node_id uuid not null references fulfilment_nodes(id) on delete restrict,
  order_number text not null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'picking', 'packed', 'dispatched', 'shipped', 'delivered', 'cancelled')),
  fulfilment_type text not null check (fulfilment_type in ('online_shipping', 'click_and_collect')),
  shipping_address_id uuid references addresses(id) on delete set null,
  collection_store_id uuid references fulfilment_nodes(id) on delete set null,
  total_amount numeric(12, 2) not null check (total_amount >= 0),
  currency text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, order_number)
);

create index if not exists orders_customer_idx on orders (customer_id);
create index if not exists orders_org_idx on orders (organisation_id);
create index if not exists orders_node_idx on orders (fulfilment_node_id);
create index if not exists orders_status_idx on orders (status);
create index if not exists orders_created_idx on orders (created_at desc);

-- Order lines: immutable once created, link to SKUs at the time of order.
create table if not exists order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  sellable_sku_id uuid not null references sellable_skus(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  line_total numeric(12, 2) not null check (line_total >= 0),
  created_at timestamptz not null default now()
);

create index if not exists order_lines_order_idx on order_lines (order_id);
create index if not exists order_lines_sku_idx on order_lines (sellable_sku_id);

-- Shipments: one per order (or one per group if split later).
-- Initially created as 'pending', transitions through carrier statuses to 'delivered'.
create table if not exists shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  tracking_number text,
  carrier text,
  carrier_status text,
  shipped_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shipments_order_idx on shipments (order_id);

-- Stripe webhook events: store by event_id to ensure idempotency.
-- Per blueprint §16: "every Stripe webhook event must be stored using its unique event ID."
create table if not exists stripe_events (
  id text primary key,
  event_type text not null,
  event_data jsonb not null,
  processed_at timestamptz not null default now(),
  order_id uuid references orders(id) on delete set null
);

create index if not exists stripe_events_order_idx on stripe_events (order_id);

-- RLS: customer can see only their own orders; staff can see by store scope.
alter table orders enable row level security;
alter table order_lines enable row level security;
alter table shipments enable row level security;
alter table stripe_events enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'orders' and policyname = 'orders_select_customer'
  ) then
    create policy orders_select_customer on orders
      for select to authenticated
      using (customer_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies where tablename = 'orders' and policyname = 'orders_select_staff'
  ) then
    create policy orders_select_staff on orders
      for select to authenticated
      using (staff_has_node_access(fulfilment_node_id));
  end if;

  if not exists (
    select 1 from pg_policies where tablename = 'order_lines' and policyname = 'order_lines_select'
  ) then
    create policy order_lines_select on order_lines
      for select to authenticated
      using (
        exists (
          select 1 from orders o
          where o.id = order_lines.order_id
            and (o.customer_id = auth.uid() or staff_has_node_access(o.fulfilment_node_id))
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies where tablename = 'shipments' and policyname = 'shipments_select'
  ) then
    create policy shipments_select on shipments
      for select to authenticated
      using (
        exists (
          select 1 from orders o
          where o.id = shipments.order_id
            and (o.customer_id = auth.uid() or staff_has_node_access(o.fulfilment_node_id))
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies where tablename = 'stripe_events' and policyname = 'stripe_events_select'
  ) then
    create policy stripe_events_select on stripe_events
      for select to authenticated
      using (
        exists (
          select 1 from organisations o
          join staff_memberships sm on sm.organisation_id = o.id
          where sm.user_id = auth.uid() and sm.active
        )
      );
  end if;
end $$;

-- Helper: has this customer made an order yet? (used for guest → customer account migration)
create or replace function customer_has_orders(customer_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists(select 1 from orders where customer_id = customer_id);
$$;

-- Helper: check if a checkout can proceed (validation per blueprint §10 "Checkout validation").
-- Called before creating pending order to ensure reservations/prices/fulfilment are still valid.
create or replace function validate_checkout(
  cart_id uuid,
  customer_id uuid
) returns json as $$
declare
  v_cart record;
  v_total_amount numeric;
  v_currency text;
  v_errors jsonb := '[]'::jsonb;
begin
  select * into v_cart from carts where id = cart_id;
  if v_cart is null then
    v_errors := v_errors || jsonb_build_array('cart_not_found');
    return jsonb_build_object('valid', false, 'errors', v_errors);
  end if;

  -- Check: all cart reservations still active (not expired)
  if exists (
    select 1 from cart_lines cl
    left join inventory_reservations r on r.id = cl.reservation_id
    where cl.cart_id = cart_id
      and (r.id is null or r.status != 'active')
  ) then
    v_errors := v_errors || jsonb_build_array('reservation_expired_or_invalid');
  end if;

  -- Check: prices haven't changed unexpectedly (within tolerances)
  -- Note: exact price validation happens in checkout handler; this is a soft check
  if exists (
    select 1 from cart_lines cl
    join sellable_skus sk on sk.id = cl.sellable_sku_id
    where cl.cart_id = cart_id
      and cl.price_at_add > (
        select final_amount from published_prices pp
        where pp.sellable_sku_id = cl.sellable_sku_id
          and pp.organisation_id = v_cart.organisation_id
        limit 1
      ) * 1.1  -- 10% price increase tolerance
  ) then
    v_errors := v_errors || jsonb_build_array('price_increased_significantly');
  end if;

  -- Check: at least one line in cart
  if not exists (select 1 from cart_lines where cart_id = cart_id) then
    v_errors := v_errors || jsonb_build_array('cart_empty');
  end if;

  return jsonb_build_object(
    'valid', jsonb_array_length(v_errors) = 0,
    'errors', v_errors
  );
end;
$$ language plpgsql security definer;
