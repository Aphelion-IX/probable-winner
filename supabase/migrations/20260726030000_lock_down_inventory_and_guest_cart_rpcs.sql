-- Closes two trust-boundary holes found in the security re-audit dated
-- 2026-07-26:
--
-- 1. reserve_inventory()/release_inventory_reservation() (B-062) were
--    granted directly to anon/authenticated with no cart-ownership check at
--    all (20260723055815's own comment says as much -- it was deliberately
--    deferred until carts existed). carts now exist (B-110) and every
--    mutation goes through add_to_cart()/update_cart_line_quantity()/
--    remove_cart_line()/merge_guest_cart_into_customer_cart(), which are
--    themselves SECURITY DEFINER, so revoking the two lower-level functions
--    from anon/authenticated does not break any legitimate caller -- a
--    SECURITY DEFINER function runs as its owner, so its internal calls to
--    other SECURITY DEFINER functions are unaffected by grants on the
--    calling role. Left as-is: anyone who directly POSTs to
--    /rest/v1/rpc/reserve_inventory can no longer manufacture reservations
--    or free someone else's stock by guessing a reservation id.
--
-- 2. add_to_cart(), update_cart_line_quantity(), remove_cart_line() and
--    merge_guest_cart_into_customer_cart() only checked ownership when
--    v_cart.customer_id was not null. A guest cart has customer_id = null by
--    definition, so the check was unconditionally skipped for every guest
--    cart -- anyone who obtained a guest cart id or cart-line id (both are
--    plain uuids returned to the browser and used in URLs/requests) could
--    read, mutate or drain another guest's basket and reservations, and
--    merge_guest_cart_into_customer_cart() let a signed-in customer claim
--    any guest cart id as their own without proving they held its
--    guest_token cookie.
--
-- Fix: every guest-cart function now takes an explicit p_guest_token
-- parameter, the same shape get_cart_contents() (20260724230000) already
-- uses -- the caller's server action reads the guest_token from the
-- httpOnly cart_session_id cookie and passes it in; it is never accepted
-- from the browser as free-form input.  A guest cart's actual guest_token
-- must match exactly; a customer cart's ownership check is unchanged.
--
-- DROP + CREATE (not CREATE OR REPLACE): adding a parameter changes the
-- function's identity (schema+name+argument types), so CREATE OR REPLACE
-- would silently create a second, additional overload rather than replacing
-- the existing 4/1/2-argument signature -- leaving the unchecked version
-- callable side-by-side. Nothing references these functions by a fixed
-- signature elsewhere (grep verified across supabase/ and apps/).

revoke execute on function reserve_inventory(uuid, uuid, integer, uuid, timestamptz) from anon, authenticated;
revoke execute on function release_inventory_reservation(uuid) from anon, authenticated;

drop function if exists add_to_cart(uuid, uuid, uuid, integer);

create function add_to_cart(
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
    v_reservation := reserve_inventory(p_fulfilment_node_id, p_sellable_sku_id, p_quantity, p_cart_id);
    insert into cart_lines (cart_id, fulfilment_node_id, sellable_sku_id, quantity, inventory_reservation_id)
    values (p_cart_id, p_fulfilment_node_id, p_sellable_sku_id, p_quantity, v_reservation.id)
    returning * into v_line;
  end if;

  return v_line;
end;
$$;

revoke execute on function add_to_cart(uuid, uuid, uuid, integer, uuid) from public;
grant execute on function add_to_cart(uuid, uuid, uuid, integer, uuid) to anon, authenticated;

drop function if exists update_cart_line_quantity(uuid, integer);

create function update_cart_line_quantity(
  p_cart_line_id uuid,
  p_new_quantity integer,
  p_guest_token uuid default null
) returns cart_lines
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line cart_lines;
  v_cart carts;
  v_reservation inventory_reservations;
begin
  if p_new_quantity < 0 then
    raise exception 'update_cart_line_quantity: quantity cannot be negative, got %', p_new_quantity;
  end if;

  select * into v_line from cart_lines where id = p_cart_line_id;
  if v_line is null then
    raise exception 'update_cart_line_quantity: unknown cart line %', p_cart_line_id;
  end if;

  select * into v_cart from carts where id = v_line.cart_id;
  if v_cart.customer_id is not null then
    if v_cart.customer_id <> auth.uid() then
      raise exception 'update_cart_line_quantity: access denied for cart %', v_cart.id using errcode = '42501';
    end if;
  else
    if p_guest_token is null or v_cart.guest_token <> p_guest_token then
      raise exception 'update_cart_line_quantity: access denied for cart %', v_cart.id using errcode = '42501';
    end if;
  end if;

  if p_new_quantity = 0 then
    perform release_inventory_reservation(v_line.inventory_reservation_id);
    delete from cart_lines where id = p_cart_line_id;
    return null;
  end if;

  perform release_inventory_reservation(v_line.inventory_reservation_id);
  v_reservation := reserve_inventory(v_line.fulfilment_node_id, v_line.sellable_sku_id, p_new_quantity, v_line.cart_id);

  update cart_lines
  set quantity = p_new_quantity, inventory_reservation_id = v_reservation.id, updated_at = now()
  where id = p_cart_line_id
  returning * into v_line;

  return v_line;
end;
$$;

revoke execute on function update_cart_line_quantity(uuid, integer, uuid) from public;
grant execute on function update_cart_line_quantity(uuid, integer, uuid) to anon, authenticated;

drop function if exists remove_cart_line(uuid);

create function remove_cart_line(p_cart_line_id uuid, p_guest_token uuid default null) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line cart_lines;
  v_cart carts;
begin
  select * into v_line from cart_lines where id = p_cart_line_id;
  if v_line is null then
    raise exception 'remove_cart_line: unknown cart line %', p_cart_line_id;
  end if;

  select * into v_cart from carts where id = v_line.cart_id;
  if v_cart.customer_id is not null then
    if v_cart.customer_id <> auth.uid() then
      raise exception 'remove_cart_line: access denied for cart %', v_cart.id using errcode = '42501';
    end if;
  else
    if p_guest_token is null or v_cart.guest_token <> p_guest_token then
      raise exception 'remove_cart_line: access denied for cart %', v_cart.id using errcode = '42501';
    end if;
  end if;

  perform release_inventory_reservation(v_line.inventory_reservation_id);
  delete from cart_lines where id = p_cart_line_id;
end;
$$;

revoke execute on function remove_cart_line(uuid, uuid) from public;
grant execute on function remove_cart_line(uuid, uuid) to anon, authenticated;

drop function if exists merge_guest_cart_into_customer_cart(uuid, uuid);

create function merge_guest_cart_into_customer_cart(
  p_guest_cart_id uuid,
  p_customer_id uuid,
  p_guest_token uuid
) returns carts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guest_cart carts;
  v_customer_cart carts;
  v_guest_line record;
  v_customer_line cart_lines;
  v_combined_quantity integer;
  v_reservation inventory_reservations;
begin
  if p_customer_id <> auth.uid() then
    raise exception 'merge_guest_cart_into_customer_cart: access denied' using errcode = '42501';
  end if;

  select * into v_guest_cart from carts where id = p_guest_cart_id;
  if v_guest_cart is null then
    raise exception 'merge_guest_cart_into_customer_cart: unknown guest cart %', p_guest_cart_id;
  end if;
  if v_guest_cart.guest_token is null then
    raise exception 'merge_guest_cart_into_customer_cart: cart % is not a guest cart', p_guest_cart_id;
  end if;

  -- Proves the caller actually holds this guest cart's cookie, not just its
  -- id -- without this, any signed-in customer who learned (or guessed) a
  -- guest cart's uuid could claim it and everything reserved under it.
  if p_guest_token is null or v_guest_cart.guest_token <> p_guest_token then
    raise exception 'merge_guest_cart_into_customer_cart: access denied' using errcode = '42501';
  end if;

  if v_guest_cart.status <> 'active' then
    select * into v_customer_cart from carts where customer_id = p_customer_id and status = 'active';
    return v_customer_cart;
  end if;

  select * into v_customer_cart from carts where customer_id = p_customer_id and status = 'active';

  if v_customer_cart is null then
    -- No existing customer cart: the guest cart itself becomes the
    -- customer's cart (its id, and every line/reservation under it, are
    -- unchanged).
    update carts set customer_id = p_customer_id, guest_token = null, updated_at = now()
    where id = p_guest_cart_id
    returning * into v_customer_cart;

    return v_customer_cart;
  end if;

  for v_guest_line in select * from cart_lines where cart_id = p_guest_cart_id
  loop
    select * into v_customer_line from cart_lines
    where cart_id = v_customer_cart.id
      and fulfilment_node_id = v_guest_line.fulfilment_node_id
      and sellable_sku_id = v_guest_line.sellable_sku_id;

    if v_customer_line is null then
      update cart_lines set cart_id = v_customer_cart.id, updated_at = now() where id = v_guest_line.id;
      update inventory_reservations set cart_id = v_customer_cart.id where id = v_guest_line.inventory_reservation_id;
    else
      v_combined_quantity := v_customer_line.quantity + v_guest_line.quantity;
      perform release_inventory_reservation(v_guest_line.inventory_reservation_id);
      perform release_inventory_reservation(v_customer_line.inventory_reservation_id);
      v_reservation := reserve_inventory(v_guest_line.fulfilment_node_id, v_guest_line.sellable_sku_id, v_combined_quantity, v_customer_cart.id);
      update cart_lines
      set quantity = v_combined_quantity, inventory_reservation_id = v_reservation.id, updated_at = now()
      where id = v_customer_line.id;
      delete from cart_lines where id = v_guest_line.id;
    end if;
  end loop;

  update carts set status = 'merged', updated_at = now() where id = p_guest_cart_id;

  return v_customer_cart;
end;
$$;

revoke execute on function merge_guest_cart_into_customer_cart(uuid, uuid, uuid) from public, anon;
grant execute on function merge_guest_cart_into_customer_cart(uuid, uuid, uuid) to authenticated;
