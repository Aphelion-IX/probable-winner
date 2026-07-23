-- Cart and reservation schema with guest/customer merge support (Phase 2, B-110).
-- Carts persist via signed cookie/session for guests; merging on login combines guest + customer cart.

create table if not exists carts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  guest_session_id text,
  customer_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint guest_or_customer check (guest_session_id is not null or customer_id is not null)
);

create index if not exists carts_customer_idx on carts (customer_id);
create index if not exists carts_session_idx on carts (guest_session_id);
create index if not exists carts_org_idx on carts (organisation_id);

-- Cart lines: immutable once created (for audit trail); link to SKU at add-time price.
create table if not exists cart_lines (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references carts(id) on delete cascade,
  sellable_sku_id uuid not null references sellable_skus(id) on delete restrict,
  reservation_id uuid references inventory_reservations(id) on delete set null,
  quantity integer not null check (quantity > 0),
  price_at_add numeric(12, 2) not null check (price_at_add >= 0),
  created_at timestamptz not null default now()
);

create index if not exists cart_lines_cart_idx on cart_lines (cart_id);
create index if not exists cart_lines_sku_idx on cart_lines (sellable_sku_id);
create index if not exists cart_lines_reservation_idx on cart_lines (reservation_id);

alter table carts enable row level security;
alter table cart_lines enable row level security;

-- RLS: customer can see own cart; guest carts validated at application layer
create policy carts_select on carts
  for select to authenticated
  using (customer_id = auth.uid());

create policy carts_insert on carts
  for insert to authenticated
  with check (customer_id = auth.uid());

create policy carts_update on carts
  for update to authenticated
  using (customer_id = auth.uid())
  with check (customer_id = auth.uid());

-- Cart lines inherit parent cart security
create policy cart_lines_select on cart_lines
  for select to authenticated
  using (
    exists (
      select 1 from carts c
      where c.id = cart_lines.cart_id and c.customer_id = auth.uid()
    )
  );

create policy cart_lines_insert on cart_lines
  for insert to authenticated
  with check (
    exists (
      select 1 from carts c
      where c.id = cart_id and c.customer_id = auth.uid()
    )
  );

create policy cart_lines_update on cart_lines
  for update to authenticated
  using (
    exists (
      select 1 from carts c
      where c.id = cart_id and c.customer_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from carts c
      where c.id = cart_id and c.customer_id = auth.uid()
    )
  );

create policy cart_lines_delete on cart_lines
  for delete to authenticated
  using (
    exists (
      select 1 from carts c
      where c.id = cart_id and c.customer_id = auth.uid()
    )
  );

-- Helper: merge guest cart into customer cart on login
create or replace function merge_guest_cart_to_customer(
  guest_session_id text,
  customer_id uuid
) returns json as $$
declare
  v_guest_cart_id uuid;
  v_customer_cart_id uuid;
  v_merged_lines integer := 0;
  v_line record;
begin
  -- Find guest cart
  select id into v_guest_cart_id from carts
  where carts.guest_session_id = merge_guest_cart_to_customer.guest_session_id
  limit 1;

  if v_guest_cart_id is null then
    -- No guest cart to merge; return existing customer cart or null
    select id into v_customer_cart_id from carts
    where carts.customer_id = merge_guest_cart_to_customer.customer_id
    limit 1;
    return jsonb_build_object('merged', false, 'customer_cart_id', v_customer_cart_id);
  end if;

  -- Find or create customer cart
  select id into v_customer_cart_id from carts
  where carts.customer_id = merge_guest_cart_to_customer.customer_id
  limit 1;

  if v_customer_cart_id is null then
    insert into carts (organisation_id, customer_id)
    select organisation_id, merge_guest_cart_to_customer.customer_id
    from carts where id = v_guest_cart_id
    returning carts.id into v_customer_cart_id;
  end if;

  -- Move guest cart lines to customer cart (skip duplicates by SKU)
  for v_line in (
    select cl.id, cl.sellable_sku_id, cl.quantity, cl.price_at_add, cl.reservation_id
    from cart_lines cl
    where cl.cart_id = v_guest_cart_id
      and not exists (
        select 1 from cart_lines existing
        where existing.cart_id = v_customer_cart_id
          and existing.sellable_sku_id = cl.sellable_sku_id
      )
  ) loop
    update cart_lines
    set cart_id = v_customer_cart_id
    where id = v_line.id;
    v_merged_lines := v_merged_lines + 1;
  end loop;

  -- Delete guest cart (cascades to any unmerged lines)
  delete from carts where id = v_guest_cart_id;

  return jsonb_build_object(
    'merged', true,
    'customer_cart_id', v_customer_cart_id,
    'lines_merged', v_merged_lines
  );
end;
$$ language plpgsql security definer;
