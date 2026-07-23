-- Order allocations schema with routing decision tracking (backlog B-130).
-- Implements blueprint §11 "Order Routing": every allocation decision is persisted
-- and auditable. Routing reason documents why a particular order was routed to a
-- specific fulfilment node (e.g., "click-and-collect store", "warehouse priority",
-- "single complete-order store", "minimum nodes", "dispatch cutoff", "transfer time",
-- "shipping cost", "safety stock", "split required").

create table order_allocations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  order_line_id uuid not null references order_lines(id) on delete cascade,
  allocated_to_node_id uuid not null references fulfilment_nodes(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  routing_reason text not null,
  allocated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index order_allocations_order_idx on order_allocations (order_id);
create index order_allocations_order_line_idx on order_allocations (order_line_id);
create index order_allocations_node_idx on order_allocations (allocated_to_node_id);
create index order_allocations_created_idx on order_allocations (created_at desc);

-- RLS: scoped by order access (customer sees own, staff sees by node scope)
alter table order_allocations enable row level security;

create policy order_allocations_select on order_allocations
  for select to authenticated
  using (
    exists (
      select 1 from orders o
      where o.id = order_allocations.order_id
        and (o.customer_id = auth.uid() or staff_has_node_access(o.fulfilment_node_id))
    )
  );

-- Helper: aggregate allocations by order to see total allocated per SKU
create or replace function get_order_allocations(order_id uuid)
returns json as $$
  select jsonb_agg(
    jsonb_build_object(
      'sku_id', ol.sellable_sku_id,
      'quantity', ol.quantity,
      'allocated_nodes', (
        select jsonb_agg(
          jsonb_build_object(
            'node_id', oa.allocated_to_node_id,
            'quantity', oa.quantity,
            'reason', oa.routing_reason
          )
        )
        from order_allocations oa
        where oa.order_line_id = ol.id
      )
    )
  )
  from order_lines ol
  where ol.order_id = order_id;
$$ language sql security definer stable;

-- Helper: verify allocation completeness (all order lines have allocations)
-- Parameter is prefixed p_ (unlike get_order_allocations() above) because
-- this function's body references order_lines.order_id and
-- order_allocations.order_id unqualified -- an unprefixed same-named
-- parameter would be an ambiguous column reference under plpgsql's default
-- variable_conflict=error, raising on every call.
create or replace function verify_order_allocation_complete(p_order_id uuid)
returns json as $$
declare
  v_total_lines integer;
  v_allocated_lines integer;
begin
  select count(*) into v_total_lines
  from order_lines where order_id = p_order_id;

  select count(distinct order_line_id) into v_allocated_lines
  from order_allocations where order_id = p_order_id;

  return jsonb_build_object(
    'complete', v_total_lines = v_allocated_lines and v_total_lines > 0,
    'total_lines', v_total_lines,
    'allocated_lines', v_allocated_lines
  );
end;
$$ language plpgsql security definer;
