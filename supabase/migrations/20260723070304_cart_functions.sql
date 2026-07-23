-- Cart atomic functions (blueprint §10, backlog B-110/B-111). All granted
-- to anon as well as authenticated -- guest carts must work before login,
-- same reasoning as reserve_inventory()/release_inventory_reservation()
-- (B-062). Every function that touches an existing cart with a
-- customer_id validates it matches auth.uid(), so an authenticated caller
-- can never read or mutate another customer's cart even via a guessed id
-- (anon callers only ever touch guest carts, which have no customer_id to
-- check against).

create or replace function get_or_create_cart(
  p_organisation_id uuid,
  p_customer_id uuid default null,
  p_guest_token uuid default null
) returns carts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cart carts;
begin
  if (p_customer_id is null) = (p_guest_token is null) then
    raise exception 'get_or_create_cart: exactly one of customer_id or guest_token must be provided';
  end if;

  if p_customer_id is not null and p_customer_id <> auth.uid() then
    raise exception 'get_or_create_cart: access denied' using errcode = '42501';
  end if;

  if p_customer_id is not null then
    select * into v_cart from carts where customer_id = p_customer_id and status = 'active';
    if v_cart is null then
      insert into carts (organisation_id, customer_id) values (p_organisation_id, p_customer_id) returning * into v_cart;
    end if;
  else
    select * into v_cart from carts where guest_token = p_guest_token and status = 'active';
    if v_cart is null then
      insert into carts (organisation_id, guest_token) values (p_organisation_id, p_guest_token) returning * into v_cart;
    end if;
  end if;

  return v_cart;
end;
$$;

revoke execute on function get_or_create_cart(uuid, uuid, uuid) from public;
grant execute on function get_or_create_cart(uuid, uuid, uuid) to anon, authenticated;

-- Adding a quantity of a SKU already in the cart combines into the
-- existing line at a new total quantity rather than creating a second
-- line for the same (cart, node, sku) -- the unique constraint on
-- cart_lines already forbids a literal duplicate row, and this is the
-- correct way to reach a larger quantity anyway: release the old
-- reservation, reserve the combined total fresh (reservations don't
-- support "add more" in place).
create or replace function add_to_cart(
  p_cart_id uuid,
  p_fulfilment_node_id uuid,
  p_sellable_sku_id uuid,
  p_quantity integer
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
  if v_cart.customer_id is not null and v_cart.customer_id <> auth.uid() then
    raise exception 'add_to_cart: access denied for cart %', p_cart_id using errcode = '42501';
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

revoke execute on function add_to_cart(uuid, uuid, uuid, integer) from public;
grant execute on function add_to_cart(uuid, uuid, uuid, integer) to anon, authenticated;

-- A new quantity of 0 removes the line (same as remove_cart_line()), so
-- callers don't need to special-case "set to zero" vs. "remove".
create or replace function update_cart_line_quantity(
  p_cart_line_id uuid,
  p_new_quantity integer
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
  if v_cart.customer_id is not null and v_cart.customer_id <> auth.uid() then
    raise exception 'update_cart_line_quantity: access denied for cart %', v_cart.id using errcode = '42501';
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

revoke execute on function update_cart_line_quantity(uuid, integer) from public;
grant execute on function update_cart_line_quantity(uuid, integer) to anon, authenticated;

create or replace function remove_cart_line(p_cart_line_id uuid) returns void
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
  if v_cart.customer_id is not null and v_cart.customer_id <> auth.uid() then
    raise exception 'remove_cart_line: access denied for cart %', v_cart.id using errcode = '42501';
  end if;

  perform release_inventory_reservation(v_line.inventory_reservation_id);
  delete from cart_lines where id = p_cart_line_id;
end;
$$;

revoke execute on function remove_cart_line(uuid) from public;
grant execute on function remove_cart_line(uuid) to anon, authenticated;

-- Merge on login (backlog B-110's core AC): union of lines, no
-- duplicates, no data loss. Colliding (node, sku) lines combine into one
-- reservation at the summed quantity; non-colliding lines are simply
-- re-parented (both the cart_line and its reservation) to the customer's
-- cart. Idempotent: merging an already-merged/abandoned/converted guest
-- cart is a no-op, matching the release_inventory_reservation() pattern.
create or replace function merge_guest_cart_into_customer_cart(
  p_guest_cart_id uuid,
  p_customer_id uuid
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

revoke execute on function merge_guest_cart_into_customer_cart(uuid, uuid) from public, anon;
grant execute on function merge_guest_cart_into_customer_cart(uuid, uuid) to authenticated;
