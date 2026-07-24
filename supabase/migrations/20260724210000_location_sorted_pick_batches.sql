-- Location-sorted pick lists (backlog B-141). create_pick_batch() sorted
-- pick_lines by order_id/sku_id only ("rough efficiency" per its own
-- comment), not by storage_locations as B-141's AC requires -- and there
-- was no way to honour that AC at all, since nothing recorded which
-- storage_location a SKU's stock sits in at a node. Add that mapping (on
-- inventory_balances, the existing per-node-per-SKU row -- nullable, since
-- not every store will have location-tagged stock from day one) and sort
-- pick_lines by the location's code, falling back to the previous
-- order_id/sku_id ordering for any as-yet-unassigned stock so pick batches
-- still work during the transition to fully location-tagged inventory.

alter table inventory_balances
  add column storage_location_id uuid references storage_locations(id) on delete set null;

create index inventory_balances_storage_location_idx
  on inventory_balances (storage_location_id);

create or replace function create_pick_batch(
  p_fulfilment_node_id uuid,
  p_max_lines integer default 50
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid;
  v_count integer;
  v_org_id uuid;
begin
  if not staff_has_node_access(p_fulfilment_node_id) then
    raise exception 'create_pick_batch: access denied for fulfilment node %', p_fulfilment_node_id
      using errcode = '42501';
  end if;

  select organisation_id into v_org_id from fulfilment_nodes where id = p_fulfilment_node_id;
  if v_org_id is null then
    raise exception 'create_pick_batch: unknown fulfilment node %', p_fulfilment_node_id;
  end if;

  insert into pick_batches (organisation_id, fulfilment_node_id, created_by_user_id)
  values (v_org_id, p_fulfilment_node_id, auth.uid())
  returning id into v_batch_id;

  -- Sorted by storage location code to minimize walking distance (B-141);
  -- allocations whose SKU has no location assignment yet sort last, then
  -- fall back to the previous order_id/sku_id ordering among themselves.
  insert into pick_lines (
    pick_batch_id, order_line_id, allocation_id, sku_id, quantity_to_pick, sort_order
  )
  select
    v_batch_id,
    ia.order_line_id,
    ia.id,
    ia.sellable_sku_id,
    ia.quantity,
    row_number() over (
      order by sl.code nulls last, ol.order_id, ia.sellable_sku_id
    )
  from inventory_allocations ia
  join order_lines ol on ol.id = ia.order_line_id
  left join inventory_balances ib
    on ib.fulfilment_node_id = ia.fulfilment_node_id
   and ib.sellable_sku_id = ia.sellable_sku_id
  left join storage_locations sl on sl.id = ib.storage_location_id
  where ia.fulfilment_node_id = p_fulfilment_node_id
    and ia.status = 'allocated'
  limit p_max_lines;

  get diagnostics v_count = row_count;

  if v_count = 0 then
    delete from pick_batches where id = v_batch_id;
    raise exception 'create_pick_batch: no pending allocations found at node %', p_fulfilment_node_id;
  end if;

  return v_batch_id;
end;
$$;

revoke execute on function create_pick_batch(uuid, integer) from public, anon;
grant execute on function create_pick_batch(uuid, integer) to authenticated;
