-- Fixes two cross-tenant defects in create_pending_order() found by a
-- follow-up re-audit of 20260726040000_atomic_pending_order_creation.sql:
--
-- 1. The published price lookup filtered only by sellable_sku_id and
--    status = 'active', with no organisation_id filter, even though
--    published_prices.unique(sellable_sku_id, organisation_id, currency)
--    exists specifically because more than one organisation can publish an
--    active price for the same (globally shared) catalogue SKU. Since
--    `limit 1` with no deterministic ordering picked whichever row the
--    planner returned first, a checkout could silently price an item using
--    a *different retailer's* price -- over- or under-charging the
--    customer relative to the storefront they were actually shopping on.
--
-- 2. p_collection_store_id was taken as given: reserved from, allocated
--    to, and written onto the order's collection_store_id with no check
--    that it belongs to the cart's organisation, is active, or actually
--    accepts click-and-collect at all. A caller could pass any fulfilment
--    node uuid (a different organisation's store, an inactive node, or a
--    warehouse with no customer-facing collection point) and the order
--    would still be created against it, and (per item 8's re-reservation
--    fix) would even re-reserve real stock there.
--
-- DROP + CREATE is not needed here -- the signature is unchanged, so
-- CREATE OR REPLACE keeps this function's grants intact (service_role
-- only, set by 20260726040000).

create or replace function create_pending_order(
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

  -- The collection store must genuinely belong to this cart's organisation,
  -- be open, and actually offer click-and-collect -- otherwise a caller
  -- could point an order (and, via the re-reservation below, real
  -- inventory) at an arbitrary node: a different retailer's store, an
  -- inactive one, or a warehouse with no customer collection point.
  if p_fulfilment_type = 'click_and_collect' then
    if not exists (
      select 1 from fulfilment_nodes
      where id = p_collection_store_id
        and organisation_id = v_cart.organisation_id
        and active
        and allows_click_collect
    ) then
      raise exception 'create_pending_order: % is not a valid click-and-collect store for this cart''s organisation', p_collection_store_id;
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
    where sellable_sku_id = v_line.sellable_sku_id
      and organisation_id = v_cart.organisation_id
      and status = 'active'
    limit 1;

    if v_unit_price is null then
      raise exception 'create_pending_order: no active price for sku % in this organisation', v_line.sellable_sku_id;
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
