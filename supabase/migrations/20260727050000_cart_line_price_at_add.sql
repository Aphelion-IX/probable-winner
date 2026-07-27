-- Cart price-drift detection (backlog B-113). The cart view previously
-- only flagged a line as a problem when its price became null (SKU no
-- longer has an active published price) -- create-pending-order.ts's own
-- comment says as much: "a cart line's price is always looked up fresh
-- from published_prices at checkout, so there's no 'price at add' to
-- detect drift against." A genuine price change between add-to-cart and
-- checkout (the price went up or down while the item sat in the cart) was
-- never surfaced to the customer before they reached payment.
--
-- This adds a price snapshot captured once, when a cart line is first
-- created, so the cart view can compare it against the current live price.
-- It is display-only: create_pending_order()/checkout's own price lookup
-- (create-pending-order.ts) remains the sole authority on what the
-- customer is actually charged and is unchanged by this migration -- this
-- column never feeds a charge, only a "heads up, this changed" banner.

alter table cart_lines add column price_at_add numeric;
alter table cart_lines add column currency_at_add text;

-- Reproduced from 20260726030000_lock_down_inventory_and_guest_cart_rpcs.sql
-- (the current definition -- same signature, same ownership checks) with
-- one addition: the insert branch (a genuinely new line, not a quantity
-- bump on an existing one) captures the sku's current active published
-- price into price_at_add/currency_at_add. The existing-line branch
-- deliberately leaves price_at_add untouched -- adding more of something
-- already in the cart isn't a new "add", so the original snapshot the
-- customer saw for this line stands.
create or replace function add_to_cart(
  p_cart_id uuid,
  p_fulfilment_node_id uuid,
  p_sellable_sku_id uuid,
  p_quantity integer,
  p_guest_token uuid default null
) returns cart_lines
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cart carts;
  v_existing cart_lines;
  v_reservation inventory_reservations;
  v_new_quantity integer;
  v_line cart_lines;
  v_price numeric;
  v_currency text;
begin
  if p_quantity <= 0 then
    raise exception 'add_to_cart: quantity must be positive, got %', p_quantity;
  end if;

  select * into v_cart from carts where id = p_cart_id;
  if v_cart is null then
    raise exception 'add_to_cart: unknown cart %', p_cart_id;
  end if;
  if v_cart.status <> 'active' then
    raise exception 'add_to_cart: cart % is %, not active', p_cart_id, v_cart.status;
  end if;

  if v_cart.customer_id is not null then
    if v_cart.customer_id <> auth.uid() then
      raise exception 'add_to_cart: access denied for cart %', p_cart_id using errcode = '42501';
    end if;
  else
    if p_guest_token is null or v_cart.guest_token <> p_guest_token then
      raise exception 'add_to_cart: access denied for cart %', p_cart_id using errcode = '42501';
    end if;
  end if;

  select * into v_existing from cart_lines
  where cart_id = p_cart_id and fulfilment_node_id = p_fulfilment_node_id and sellable_sku_id = p_sellable_sku_id;

  if v_existing is not null then
    v_new_quantity := v_existing.quantity + p_quantity;
    perform release_inventory_reservation(v_existing.inventory_reservation_id);
    v_reservation := reserve_inventory(p_fulfilment_node_id, p_sellable_sku_id, v_new_quantity, p_cart_id);
    update cart_lines
    set quantity = v_new_quantity, inventory_reservation_id = v_reservation.id, updated_at = now()
    where id = v_existing.id
    returning * into v_line;
  else
    select final_amount, currency into v_price, v_currency
    from published_prices
    where sellable_sku_id = p_sellable_sku_id and status = 'active'
    limit 1;

    v_reservation := reserve_inventory(p_fulfilment_node_id, p_sellable_sku_id, p_quantity, p_cart_id);
    insert into cart_lines (
      cart_id, fulfilment_node_id, sellable_sku_id, quantity, inventory_reservation_id,
      price_at_add, currency_at_add
    )
    values (
      p_cart_id, p_fulfilment_node_id, p_sellable_sku_id, p_quantity, v_reservation.id,
      v_price, v_currency
    )
    returning * into v_line;
  end if;

  return v_line;
end;
$$;

-- Composite return type change (adding a field) requires drop + recreate,
-- not CREATE OR REPLACE TYPE (Postgres has no such statement) -- the
-- function returning it must be dropped first since it depends on the
-- type, then both are recreated together. Grants are re-applied below
-- since dropping the function drops them too.
drop function if exists get_cart_contents(uuid);
drop type if exists cart_contents_line;

create type cart_contents_line as (
  cart_line_id uuid,
  cart_id uuid,
  sellable_sku_id uuid,
  fulfilment_node_id uuid,
  quantity integer,
  reservation_expires_at timestamptz,
  card_name text,
  set_code text,
  rarity text,
  finish_code text,
  finish_name text,
  condition_code text,
  condition_name text,
  price numeric,
  currency text,
  price_at_add numeric,
  currency_at_add text
);

create or replace function get_cart_contents(p_guest_token uuid default null)
returns setof cart_contents_line
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cart carts;
begin
  if p_guest_token is not null then
    select * into v_cart from carts where guest_token = p_guest_token and status = 'active';
  else
    if auth.uid() is null then
      raise exception 'get_cart_contents: must provide guest_token or be authenticated' using errcode = '42501';
    end if;
    select * into v_cart from carts where customer_id = auth.uid() and status = 'active';
  end if;

  if v_cart is null then
    return;
  end if;

  return query
    select
      cl.id,
      cl.cart_id,
      cl.sellable_sku_id,
      cl.fulfilment_node_id,
      cl.quantity,
      ir.expires_at,
      oc.name,
      s.code,
      cp.rarity,
      f.code,
      f.name,
      c.code,
      c.name,
      pp.final_amount,
      pp.currency,
      cl.price_at_add,
      cl.currency_at_add
    from cart_lines cl
    join inventory_reservations ir on ir.id = cl.inventory_reservation_id
    join sellable_skus sk on sk.id = cl.sellable_sku_id
    join card_printings cp on cp.id = sk.card_printing_id
    join oracle_cards oc on oc.id = cp.oracle_card_id
    join sets s on s.id = cp.set_id
    join finishes f on f.id = sk.finish_id
    join conditions c on c.id = sk.condition_id
    left join published_prices pp on pp.sellable_sku_id = sk.id and pp.status = 'active'
    where cl.cart_id = v_cart.id
    order by cl.created_at asc;
end;
$$;

revoke execute on function get_cart_contents(uuid) from public;
grant execute on function get_cart_contents(uuid) to anon, authenticated;
