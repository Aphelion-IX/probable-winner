-- Replaces checkout's multi-step order creation (previously orchestrated
-- from apps/web/src/app/actions/create-pending-order.ts as five separate
-- privileged writes: address insert, order insert, order_lines insert, the
-- persist_order_allocations() RPC, then an order total update) with one
-- SECURITY DEFINER function, per the 2026-07-26 security re-audit's items 3,
-- 5, 6 and 8:
--
-- 3. persist_order_allocations() was granted to `authenticated` with no
--    ownership or service-role check at all, despite its own comment
--    claiming it is a server/service-role-only function. It is dropped here
--    rather than re-granted, since create_pending_order() now performs the
--    same insert directly, in the same transaction, using the order_line_id
--    it already has in hand -- there is no longer a separate RPC boundary
--    to lock down.
--
-- 5. A failure partway through the old five-step sequence (e.g. the
--    persist_order_allocations RPC erroring after order_lines had already
--    been inserted) left partial rows behind: an order stuck at its $0
--    placeholder, order lines with no allocations, or a reservation still
--    attached to a cart that's supposedly been checked out. A single
--    plpgsql function is one transaction -- any exception rolls back every
--    write it made, with nothing to clean up.
--
-- 6. order_lines had no link back to the reservation/cart_line it was
--    created from, so confirm_order_payment()/release_failed_order_reservations()
--    (companion migration 20260726050000) could only join back to
--    cart_lines by sellable_sku_id -- ambiguous whenever more than one
--    active cart holds a reservation for the same SKU. order_lines now
--    carries inventory_reservation_id directly, captured from the exact
--    reservation this line's stock came from.
--
-- 8. Click-and-collect allocations were rewritten to the customer's chosen
--    store regardless of which node the line's stock was actually reserved
--    at (cart lines are always reserved from resolveDefaultStore()'s single
--    default online store today -- there's no live "pick your store before
--    adding to cart" flow yet). That could allocate stock at a store that
--    never actually held it. When the chosen collection store differs from
--    a line's reservation node, this function now releases the original
--    reservation and reserves the same quantity at the collection store
--    instead -- an ordinary reserve_inventory() call, so it fails (and
--    rolls back the whole order) exactly like any other oversell attempt if
--    the collection store doesn't have the stock. The alternative the audit
--    also allows -- a real inter-store transfer requirement -- is a bigger
--    feature (transfer_orders already exists for staff-initiated transfers,
--    blueprint's dispatch/receive flow) than fits this hardening pass.

alter table order_lines add column if not exists inventory_reservation_id uuid references inventory_reservations(id);
create index if not exists order_lines_reservation_idx on order_lines (inventory_reservation_id);

drop function if exists persist_order_allocations(uuid, jsonb);

create function create_pending_order(
  p_cart_id uuid,
  p_customer_id uuid,
  p_guest_token uuid,
  p_fulfilment_type text, -- 'online_shipping' | 'click_and_collect'
  p_address jsonb default null, -- {line1, line2, suburb, state, postcode}
  p_collection_store_id uuid default null
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cart carts;
  v_line record;
  v_target_node_id uuid;
  v_node_type text;
  v_reservation inventory_reservations;
  v_unit_price numeric(12, 2);
  v_order_id uuid;
  v_order_number text;
  v_line_id uuid;
  v_line_total numeric(12, 2);
  v_total_amount numeric(12, 2) := 0;
  v_shipping_address_id uuid;
  v_primary_node_id uuid;
  v_distinct_node_count integer;
  v_is_single_node boolean;
  v_reason text;
begin
  if p_fulfilment_type not in ('online_shipping', 'click_and_collect') then
    raise exception 'create_pending_order: invalid fulfilment type %', p_fulfilment_type;
  end if;

  if p_fulfilment_type = 'click_and_collect' and p_collection_store_id is null then
    raise exception 'create_pending_order: collection store is required for click and collect';
  end if;

  if p_fulfilment_type = 'online_shipping' and p_address is null then
    raise exception 'create_pending_order: delivery address is required';
  end if;

  -- Locks the cart for the rest of this transaction: a second concurrent
  -- checkout of the same cart blocks here rather than racing to create two
  -- orders from one basket, and sees status = 'converted' (not 'active')
  -- once this call commits.
  select * into v_cart from carts where id = p_cart_id for update;
  if v_cart is null then
    raise exception 'create_pending_order: unknown cart %', p_cart_id;
  end if;

  if v_cart.status <> 'active' then
    raise exception 'create_pending_order: cart % is %, not active', p_cart_id, v_cart.status;
  end if;

  if v_cart.customer_id is not null then
    if p_customer_id is null or v_cart.customer_id <> p_customer_id then
      raise exception 'create_pending_order: access denied for cart %', p_cart_id using errcode = '42501';
    end if;
  else
    if p_guest_token is null or v_cart.guest_token <> p_guest_token then
      raise exception 'create_pending_order: access denied for cart %', p_cart_id using errcode = '42501';
    end if;
  end if;

  if not exists (select 1 from cart_lines where cart_id = p_cart_id) then
    raise exception 'create_pending_order: cart % is empty', p_cart_id;
  end if;

  create temporary table if not exists pending_order_lines_tmp (
    sellable_sku_id uuid,
    quantity integer,
    node_id uuid,
    node_type text,
    reservation_id uuid,
    unit_price numeric(12, 2)
  ) on commit drop;
  delete from pending_order_lines_tmp;

  for v_line in
    select cl.id, cl.sellable_sku_id, cl.quantity, cl.fulfilment_node_id, cl.inventory_reservation_id
    from cart_lines cl
    where cl.cart_id = p_cart_id
  loop
    select * into v_reservation from inventory_reservations where id = v_line.inventory_reservation_id;
    if v_reservation is null or v_reservation.status <> 'active' or v_reservation.expires_at < now() then
      raise exception 'create_pending_order: reservation for cart line % is no longer active', v_line.id;
    end if;

    select final_amount into v_unit_price
    from published_prices
    where sellable_sku_id = v_line.sellable_sku_id and status = 'active'
    limit 1;

    if v_unit_price is null then
      raise exception 'create_pending_order: no active price for sku %', v_line.sellable_sku_id;
    end if;

    v_target_node_id := case
      when p_fulfilment_type = 'click_and_collect' then p_collection_store_id
      else v_line.fulfilment_node_id
    end;

    if v_target_node_id <> v_line.fulfilment_node_id then
      perform release_inventory_reservation(v_reservation.id);
      v_reservation := reserve_inventory(v_target_node_id, v_line.sellable_sku_id, v_line.quantity, p_cart_id);
    end if;

    select type into v_node_type from fulfilment_nodes where id = v_target_node_id;

    insert into pending_order_lines_tmp (sellable_sku_id, quantity, node_id, node_type, reservation_id, unit_price)
    values (v_line.sellable_sku_id, v_line.quantity, v_target_node_id, v_node_type, v_reservation.id, v_unit_price);
  end loop;

  select count(distinct node_id) into v_distinct_node_count from pending_order_lines_tmp;
  v_is_single_node := (p_fulfilment_type = 'click_and_collect') or (v_distinct_node_count <= 1);

  if p_fulfilment_type = 'click_and_collect' then
    v_primary_node_id := p_collection_store_id;
  else
    select node_id into v_primary_node_id
    from pending_order_lines_tmp
    group by node_id
    order by sum(quantity) desc
    limit 1;
  end if;

  if p_fulfilment_type = 'online_shipping' then
    insert into addresses (
      organisation_id, recipient_name, line_1, line_2, suburb_city, state_province, postcode_zip, country_code
    ) values (
      v_cart.organisation_id, 'Customer',
      p_address->>'line1', nullif(p_address->>'line2', ''),
      p_address->>'suburb', p_address->>'state', p_address->>'postcode', 'AU'
    )
    returning id into v_shipping_address_id;
  end if;

  v_order_number := 'ORD-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-'
    || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into orders (
    organisation_id, customer_id, guest_token, fulfilment_node_id, order_number, status,
    fulfilment_type, shipping_address_id, collection_store_id, total_amount, currency
  ) values (
    v_cart.organisation_id, v_cart.customer_id, v_cart.guest_token, v_primary_node_id, v_order_number, 'pending',
    p_fulfilment_type, v_shipping_address_id,
    case when p_fulfilment_type = 'click_and_collect' then p_collection_store_id else null end,
    0, 'AUD'
  )
  returning id into v_order_id;

  for v_line in select * from pending_order_lines_tmp
  loop
    v_line_total := round(v_line.unit_price * v_line.quantity, 2);
    v_total_amount := v_total_amount + v_line_total;

    insert into order_lines (order_id, sellable_sku_id, quantity, unit_price, line_total, inventory_reservation_id)
    values (v_order_id, v_line.sellable_sku_id, v_line.quantity, v_line.unit_price, v_line_total, v_line.reservation_id)
    returning id into v_line_id;

    -- Same routing-reason vocabulary as packages/routing's
    -- classify_allocation_reason() (blueprint §11), reimplemented here so
    -- the decision is made from the final (possibly re-reserved) node in
    -- the same transaction that writes it, rather than recomputed in JS
    -- afterward from data that could already be stale.
    v_reason := case
      when p_fulfilment_type = 'click_and_collect' then 'click_and_collect_store'
      when v_line.node_type = 'warehouse' then 'warehouse_priority'
      when v_is_single_node then 'single_complete_order_store'
      else 'split_minimum_nodes'
    end;

    insert into order_allocations (order_id, order_line_id, allocated_to_node_id, quantity, routing_reason)
    values (v_order_id, v_line_id, v_line.node_id, v_line.quantity, v_reason);
  end loop;

  update orders set total_amount = v_total_amount, updated_at = now() where id = v_order_id;

  -- The cart's job is done: it stops being anyone's "active" cart (freeing
  -- get_or_create_cart() to start a fresh one) and its lines/reservations
  -- are no longer reachable through ordinary cart mutation.
  update carts set status = 'converted', updated_at = now() where id = p_cart_id;

  delete from pending_order_lines_tmp;

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'total_amount', v_total_amount
  );
end;
$$;

revoke execute on function create_pending_order(uuid, uuid, uuid, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function create_pending_order(uuid, uuid, uuid, text, jsonb, uuid) to service_role;
