-- Reading a cart's contents (Step 12 / B-110/B-111's storefront cart page)
-- hits the same "no raw table RLS for guest carts" wall documented in
-- 20260723070153_carts.sql: a guest_token has no auth.uid() to check
-- against, so carts_select_own/cart_lines_select_own never match a guest.
-- Guest cart reads, like guest cart writes, go entirely through a
-- SECURITY DEFINER function that takes the guest_token explicitly.
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
  currency text
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
      pp.currency
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
