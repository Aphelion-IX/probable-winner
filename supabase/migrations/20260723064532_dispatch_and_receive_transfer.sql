-- dispatch_transfer() and receive_transfer() (blueprint §9.3/§12, backlog
-- B-071/B-072). Both staff-gated: dispatch requires access to the source
-- node, receipt requires access to the destination node -- a store
-- shouldn't be able to dispatch stock out of a node it doesn't manage, or
-- receive into one it doesn't manage.
--
-- The B-071 "never available at both source and destination" invariant
-- holds by construction, not by an extra check: dispatch_transfer()
-- decrements the source's quantity_on_hand/quantity_available_online (the
-- same relative-update-on-a-locked-row pattern as every other atomic
-- function here) and receive_transfer() only ever increments the
-- destination's by quantity_good. There is no "in transit" balance bucket
-- anywhere (blueprint §9.1's inventory_balances columns don't have one) --
-- while a shipment is between dispatch and receipt, the transferred stock
-- exists only as transfer_shipments/transfer_receipts rows, not as
-- available inventory at either node.

create or replace function dispatch_transfer(
  p_transfer_order_id uuid
) returns transfer_shipments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transfer transfer_orders;
  v_shipment transfer_shipments;
  v_line record;
begin
  select * into v_transfer from transfer_orders where id = p_transfer_order_id;
  if v_transfer is null then
    raise exception 'dispatch_transfer: unknown transfer order %', p_transfer_order_id;
  end if;

  if v_transfer.status <> 'picking' then
    raise exception 'dispatch_transfer: transfer order % is %, not picking -- cannot dispatch', p_transfer_order_id, v_transfer.status;
  end if;

  if not staff_has_node_access(v_transfer.source_fulfilment_node_id) then
    raise exception 'dispatch_transfer: access denied for fulfilment node %', v_transfer.source_fulfilment_node_id
      using errcode = '42501';
  end if;

  insert into transfer_shipments (transfer_order_id, dispatched_by)
  values (p_transfer_order_id, auth.uid())
  returning * into v_shipment;

  for v_line in select * from transfer_order_lines where transfer_order_id = p_transfer_order_id
  loop
    perform lock_inventory_balance(v_transfer.source_fulfilment_node_id, v_line.sellable_sku_id);

    begin
      update inventory_balances
      set quantity_on_hand = quantity_on_hand - v_line.quantity_requested,
          quantity_available_online = quantity_available_online - v_line.quantity_requested,
          updated_at = now()
      where fulfilment_node_id = v_transfer.source_fulfilment_node_id and sellable_sku_id = v_line.sellable_sku_id;
    exception when check_violation then
      raise exception 'dispatch_transfer: insufficient available inventory to dispatch sku % from node %', v_line.sellable_sku_id, v_transfer.source_fulfilment_node_id
        using errcode = '23514';
    end;

    insert into inventory_movements (
      organisation_id, fulfilment_node_id, sellable_sku_id, movement_type,
      quantity_delta, reference_type, reference_id, staff_user_id
    ) values (
      v_transfer.organisation_id, v_transfer.source_fulfilment_node_id, v_line.sellable_sku_id, 'transfer_out',
      -v_line.quantity_requested, 'transfer_shipment', v_shipment.id, auth.uid()
    );
  end loop;

  update transfer_orders set status = 'dispatched', updated_at = now() where id = p_transfer_order_id;

  return v_shipment;
end;
$$;

revoke execute on function dispatch_transfer(uuid) from public, anon;
grant execute on function dispatch_transfer(uuid) to authenticated;

-- p_lines: jsonb array of {"sellableSkuId": uuid, "quantityGood": int,
-- "quantityDamaged": int, "quantityMissing": int} -- one entry per SKU
-- being processed in this receiving session. Supports partial receipt
-- (backlog B-072) by design: call this once per physical delivery/receiving
-- session against the same transfer order, and it accumulates against each
-- line's transfer_receipts history rather than assuming one call covers
-- everything.
create or replace function receive_transfer(
  p_transfer_order_id uuid,
  p_lines jsonb
) returns setof transfer_receipts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transfer transfer_orders;
  v_shipment_id uuid;
  v_line jsonb;
  v_sku_id uuid;
  v_good integer;
  v_damaged integer;
  v_missing integer;
  v_requested integer;
  v_already_accounted integer;
  v_receipt transfer_receipts;
  v_all_accounted boolean;
begin
  select * into v_transfer from transfer_orders where id = p_transfer_order_id;
  if v_transfer is null then
    raise exception 'receive_transfer: unknown transfer order %', p_transfer_order_id;
  end if;

  if v_transfer.status not in ('dispatched', 'in_transit', 'partially_received') then
    raise exception 'receive_transfer: transfer order % is %, not dispatched/in_transit/partially_received -- cannot receive', p_transfer_order_id, v_transfer.status;
  end if;

  if not staff_has_node_access(v_transfer.destination_fulfilment_node_id) then
    raise exception 'receive_transfer: access denied for fulfilment node %', v_transfer.destination_fulfilment_node_id
      using errcode = '42501';
  end if;

  select id into v_shipment_id from transfer_shipments where transfer_order_id = p_transfer_order_id order by dispatched_at desc limit 1;
  if v_shipment_id is null then
    raise exception 'receive_transfer: transfer order % has no dispatched shipment', p_transfer_order_id;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_sku_id := (v_line ->> 'sellableSkuId')::uuid;
    v_good := coalesce((v_line ->> 'quantityGood')::integer, 0);
    v_damaged := coalesce((v_line ->> 'quantityDamaged')::integer, 0);
    v_missing := coalesce((v_line ->> 'quantityMissing')::integer, 0);

    select quantity_requested into v_requested
    from transfer_order_lines
    where transfer_order_id = p_transfer_order_id and sellable_sku_id = v_sku_id;

    if v_requested is null then
      raise exception 'receive_transfer: sku % is not part of transfer order %', v_sku_id, p_transfer_order_id;
    end if;

    select coalesce(sum(quantity_good + quantity_damaged + quantity_missing), 0) into v_already_accounted
    from transfer_receipts
    where transfer_order_id = p_transfer_order_id and sellable_sku_id = v_sku_id;

    if v_already_accounted + v_good + v_damaged + v_missing > v_requested then
      raise exception 'receive_transfer: sku % would account for more than the requested quantity % (already accounted %, this receipt %)',
        v_sku_id, v_requested, v_already_accounted, v_good + v_damaged + v_missing;
    end if;

    insert into transfer_receipts (
      transfer_order_id, transfer_shipment_id, sellable_sku_id,
      quantity_good, quantity_damaged, quantity_missing, received_by
    ) values (
      p_transfer_order_id, v_shipment_id, v_sku_id, v_good, v_damaged, v_missing, auth.uid()
    )
    returning * into v_receipt;

    if v_good > 0 then
      perform lock_inventory_balance(v_transfer.destination_fulfilment_node_id, v_sku_id);

      update inventory_balances
      set quantity_on_hand = quantity_on_hand + v_good,
          quantity_available_online = quantity_available_online + v_good,
          updated_at = now()
      where fulfilment_node_id = v_transfer.destination_fulfilment_node_id and sellable_sku_id = v_sku_id;

      insert into inventory_movements (
        organisation_id, fulfilment_node_id, sellable_sku_id, movement_type,
        quantity_delta, reference_type, reference_id, staff_user_id
      ) values (
        v_transfer.organisation_id, v_transfer.destination_fulfilment_node_id, v_sku_id, 'transfer_in',
        v_good, 'transfer_receipt', v_receipt.id, auth.uid()
      );
    end if;

    return next v_receipt;
  end loop;

  select bool_and(fully_accounted) into v_all_accounted
  from (
    select
      tol.quantity_requested <= coalesce((
        select sum(quantity_good + quantity_damaged + quantity_missing)
        from transfer_receipts tr
        where tr.transfer_order_id = p_transfer_order_id and tr.sellable_sku_id = tol.sellable_sku_id
      ), 0) as fully_accounted
    from transfer_order_lines tol
    where tol.transfer_order_id = p_transfer_order_id
  ) sub;

  if v_all_accounted then
    update transfer_orders set status = 'received', updated_at = now() where id = p_transfer_order_id;
  else
    update transfer_orders set status = 'partially_received', updated_at = now() where id = p_transfer_order_id and status <> 'partially_received';
  end if;

  return;
end;
$$;

revoke execute on function receive_transfer(uuid, jsonb) from public, anon;
grant execute on function receive_transfer(uuid, jsonb) to authenticated;
