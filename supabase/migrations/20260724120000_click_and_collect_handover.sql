-- Click-and-collect handover tracking (backlog B-145).
-- Records when customers collect orders from stores with staff verification.

create table order_handovers (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  fulfilment_node_id uuid not null references fulfilment_nodes(id),
  handed_over_at timestamptz not null default now(),
  handed_over_by_user_id uuid not null references auth.users(id) on delete restrict,
  customer_signed_at timestamptz,
  customer_signature_url text, -- optional digital signature
  notes text,
  created_at timestamptz not null default now()
);

create index order_handovers_order_idx on order_handovers (order_id);
create index order_handovers_node_idx on order_handovers (fulfilment_node_id);
create index order_handovers_created_idx on order_handovers (created_at desc);

-- RLS: staff can record handovers at their nodes, customers can view own handovers
alter table order_handovers enable row level security;

create policy order_handovers_select_staff on order_handovers
  for select to authenticated
  using (staff_has_node_access(fulfilment_node_id));

create policy order_handovers_select_customer on order_handovers
  for select to authenticated
  using (
    exists (
      select 1 from orders o
      where o.id = order_handovers.order_id
        and o.customer_id = auth.uid()
    )
  );

create policy order_handovers_insert on order_handovers
  for insert to authenticated
  with check (staff_has_node_access(fulfilment_node_id));

-- Helper: record order handover when customer collects at store
create or replace function record_order_handover(
  p_order_id uuid,
  p_fulfilment_node_id uuid,
  p_notes text default null
)
returns order_handovers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders;
  v_handover order_handovers;
begin
  select * into v_order from orders where id = p_order_id;
  if v_order is null then
    raise exception 'record_order_handover: unknown order %', p_order_id;
  end if;

  if v_order.fulfillment_type <> 'click_and_collect' then
    raise exception 'record_order_handover: order % is not click-and-collect', p_order_id;
  end if;

  if v_order.fulfilment_node_id <> p_fulfilment_node_id then
    raise exception 'record_order_handover: order not allocated to node %', p_fulfilment_node_id;
  end if;

  if not staff_has_node_access(p_fulfilment_node_id) then
    raise exception 'record_order_handover: access denied for fulfilment node %', p_fulfilment_node_id
      using errcode = '42501';
  end if;

  if exists (select 1 from order_handovers where order_id = p_order_id and handed_over_at is not null) then
    raise exception 'record_order_handover: order % already handed over', p_order_id;
  end if;

  insert into order_handovers (
    order_id, fulfilment_node_id, handed_over_by_user_id, notes
  ) values (
    p_order_id, p_fulfilment_node_id, auth.uid(), p_notes
  )
  returning * into v_handover;

  return v_handover;
end;
$$;

revoke execute on function record_order_handover(uuid, uuid, text) from public, anon;
grant execute on function record_order_handover(uuid, uuid, text) to authenticated;

-- Helper: get click-and-collect orders ready for handover at a node
-- total_amount is numeric(12,2), matching orders.total_amount exactly
-- (20260723081706_orders_and_shipments_v2.sql) -- declaring it integer
-- here would round every order total to whole dollars on return.
create or replace function get_ready_for_handover_orders(p_fulfilment_node_id uuid)
returns table (
  order_id uuid,
  order_number text,
  customer_id uuid,
  total_amount numeric(12, 2),
  currency text,
  status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not staff_has_node_access(p_fulfilment_node_id) then
    raise exception 'get_ready_for_handover_orders: access denied for fulfilment node %', p_fulfilment_node_id
      using errcode = '42501';
  end if;

  return query
    select
      o.id,
      o.order_number,
      o.customer_id,
      o.total_amount,
      o.currency,
      o.status,
      o.created_at
    from orders o
    where o.fulfilment_node_id = p_fulfilment_node_id
      and o.fulfillment_type = 'click_and_collect'
      -- 'ready' isn't a value orders.status's CHECK constraint allows
      -- (pending/paid/picking/packed/dispatched/shipped/delivered/cancelled,
      -- 20260723081706_orders_and_shipments_v2.sql) -- as originally
      -- written this filter matched zero rows, ever. 'packed' is the
      -- closest existing status to "ready for the customer to collect"
      -- for a click-and-collect order (there's no dispatch/shipping leg).
      and o.status = 'packed'
      and not exists (
        select 1 from order_handovers oh
        where oh.order_id = o.id
      )
    order by o.created_at asc;
end;
$$;

revoke execute on function get_ready_for_handover_orders(uuid) from public, anon;
grant execute on function get_ready_for_handover_orders(uuid) to authenticated;
