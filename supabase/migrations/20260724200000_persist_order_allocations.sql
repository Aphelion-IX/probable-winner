-- persist_order_allocations() (backlog B-130/B-131). order_allocations had no
-- write path at all -- checkout's createPendingOrder() picked a fulfilment
-- node with a plain "grab any node for the org" placeholder query and never
-- recorded why, leaving B-130's "every allocation decision is persisted and
-- auditable" AC unmet. This inserts one order_allocations row per line,
-- resolving order_line_id by matching sellable_sku_id within the order
-- (order_lines has no natural key back to a cart_line/sku pairing beyond
-- that, since a given order line is already scoped to one order).

create or replace function persist_order_allocations(
  p_order_id uuid,
  p_allocations jsonb -- array of {sku_id, node_id, quantity, reason}
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allocation jsonb;
  v_order_line_id uuid;
begin
  for v_allocation in select * from jsonb_array_elements(p_allocations)
  loop
    select id into v_order_line_id
    from order_lines
    where order_id = p_order_id
      and sellable_sku_id = (v_allocation->>'sku_id')::uuid
    limit 1;

    if v_order_line_id is null then
      raise exception 'persist_order_allocations: no order_line found for order % sku %',
        p_order_id, v_allocation->>'sku_id';
    end if;

    insert into order_allocations (
      order_id, order_line_id, allocated_to_node_id, quantity, routing_reason
    ) values (
      p_order_id,
      v_order_line_id,
      (v_allocation->>'node_id')::uuid,
      (v_allocation->>'quantity')::integer,
      v_allocation->>'reason'
    );
  end loop;
end;
$$;

-- Same trust boundary as create_pending_order()'s other writes: called from
-- the checkout Server Action (server-only, service-role), not directly by
-- browser code, so no staff_has_node_access() gate is needed here (unlike
-- the staff-triggered pick/allocate functions in B-063/B-141).
revoke execute on function persist_order_allocations(uuid, jsonb) from public, anon;
grant execute on function persist_order_allocations(uuid, jsonb) to authenticated, service_role;
