-- quarantine_inventory() and release_inventory_quarantine() (blueprint
-- §9.3, backlog B-064). Staff-gated like B-061's functions -- deciding to
-- quarantine stock is a staff judgement call, not a customer action.
--
-- Movement type: the §9.2 enum has a single 'quarantine' type, not a
-- separate "release from quarantine" type (unlike reserve/
-- release_reservation). Following the sign convention established in
-- B-062: quantity_delta is signed relative to quantity_quarantined, the
-- bucket 'quarantine' movements represent -- positive entering quarantine,
-- negative leaving it.
--
-- Quarantining moves stock between quantity_quarantined and
-- quantity_available_online; quantity_on_hand is untouched (blueprint §9.1/
-- docs/inventory-rules.md: a quarantined unit is still physically on
-- hand, just unsellable).

create or replace function quarantine_inventory(
  p_fulfilment_node_id uuid,
  p_sellable_sku_id uuid,
  p_quantity integer,
  p_reason text,
  p_reference_type text default null,
  p_reference_id uuid default null
) returns quarantined_inventory
language plpgsql
security definer
set search_path = public
as $$
declare
  v_organisation_id uuid;
  v_record quarantined_inventory;
begin
  if p_quantity <= 0 then
    raise exception 'quarantine_inventory: quantity must be positive, got %', p_quantity;
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'quarantine_inventory: a reason is required';
  end if;

  select organisation_id into v_organisation_id
  from fulfilment_nodes where id = p_fulfilment_node_id;

  if v_organisation_id is null then
    raise exception 'quarantine_inventory: unknown fulfilment node %', p_fulfilment_node_id;
  end if;

  if not staff_has_node_access(p_fulfilment_node_id) then
    raise exception 'quarantine_inventory: access denied for fulfilment node %', p_fulfilment_node_id
      using errcode = '42501';
  end if;

  perform lock_inventory_balance(p_fulfilment_node_id, p_sellable_sku_id);

  begin
    update inventory_balances
    set quantity_quarantined = quantity_quarantined + p_quantity,
        quantity_available_online = quantity_available_online - p_quantity,
        updated_at = now()
    where fulfilment_node_id = p_fulfilment_node_id and sellable_sku_id = p_sellable_sku_id;
  exception when check_violation then
    raise exception 'quarantine_inventory: insufficient available inventory to quarantine for node %, sku %', p_fulfilment_node_id, p_sellable_sku_id
      using errcode = '23514';
  end;

  insert into quarantined_inventory (
    organisation_id, fulfilment_node_id, sellable_sku_id, quantity, reason, reference_type, reference_id
  ) values (
    v_organisation_id, p_fulfilment_node_id, p_sellable_sku_id, p_quantity, p_reason, p_reference_type, p_reference_id
  )
  returning * into v_record;

  insert into inventory_movements (
    organisation_id, fulfilment_node_id, sellable_sku_id, movement_type,
    quantity_delta, reference_type, reference_id, staff_user_id, reason
  ) values (
    v_organisation_id, p_fulfilment_node_id, p_sellable_sku_id, 'quarantine',
    p_quantity, 'quarantined_inventory', v_record.id, auth.uid(), p_reason
  );

  return v_record;
end;
$$;

revoke execute on function quarantine_inventory(uuid, uuid, integer, text, text, uuid) from public, anon;
grant execute on function quarantine_inventory(uuid, uuid, integer, text, text, uuid) to authenticated;

create or replace function release_inventory_quarantine(
  p_quarantine_id uuid
) returns quarantined_inventory
language plpgsql
security definer
set search_path = public
as $$
declare
  v_record quarantined_inventory;
begin
  select * into v_record from quarantined_inventory where id = p_quarantine_id;

  if v_record is null then
    raise exception 'release_inventory_quarantine: unknown quarantine record %', p_quarantine_id;
  end if;

  if not staff_has_node_access(v_record.fulfilment_node_id) then
    raise exception 'release_inventory_quarantine: access denied for fulfilment node %', v_record.fulfilment_node_id
      using errcode = '42501';
  end if;

  -- No-op for an already-released record, mirroring
  -- release_inventory_reservation's idempotency (B-062).
  if v_record.status <> 'quarantined' then
    return v_record;
  end if;

  perform lock_inventory_balance(v_record.fulfilment_node_id, v_record.sellable_sku_id);

  update inventory_balances
  set quantity_quarantined = quantity_quarantined - v_record.quantity,
      quantity_available_online = quantity_available_online + v_record.quantity,
      updated_at = now()
  where fulfilment_node_id = v_record.fulfilment_node_id and sellable_sku_id = v_record.sellable_sku_id;

  update quarantined_inventory
  set status = 'released', released_at = now(), updated_at = now()
  where id = p_quarantine_id
  returning * into v_record;

  insert into inventory_movements (
    organisation_id, fulfilment_node_id, sellable_sku_id, movement_type,
    quantity_delta, reference_type, reference_id, staff_user_id
  ) values (
    v_record.organisation_id, v_record.fulfilment_node_id, v_record.sellable_sku_id,
    'quarantine', -v_record.quantity, 'quarantined_inventory', v_record.id, auth.uid()
  );

  return v_record;
end;
$$;

revoke execute on function release_inventory_quarantine(uuid) from public, anon;
grant execute on function release_inventory_quarantine(uuid) to authenticated;
