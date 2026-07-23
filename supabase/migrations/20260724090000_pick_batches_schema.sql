-- Pick batch tracking for order fulfillment (backlog B-141).
-- Batches group order lines for efficient picking within a store/warehouse.
-- Each batch represents a logical unit of work for a single picker/team.

create table pick_batches (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  fulfilment_node_id uuid not null references fulfilment_nodes(id) on delete cascade,
  status text not null check (status in ('pending', 'in_progress', 'completed', 'cancelled'))
    default 'pending',
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  completed_by_user_id uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index pick_batches_node_status_idx on pick_batches (fulfilment_node_id, status);
create index pick_batches_created_idx on pick_batches (created_at desc);

-- Individual lines within a batch, sorted for efficient picking
-- (e.g., by storage location / aisle to minimize walking)
create table pick_lines (
  id uuid primary key default gen_random_uuid(),
  pick_batch_id uuid not null references pick_batches(id) on delete cascade,
  order_line_id uuid not null references order_lines(id) on delete restrict,
  allocation_id uuid not null references inventory_allocations(id) on delete restrict,
  sku_id uuid not null references sellable_skus(id),
  quantity_to_pick integer not null check (quantity_to_pick > 0),
  quantity_picked integer not null default 0 check (quantity_picked >= 0 and quantity_picked <= quantity_to_pick),
  condition_confirmed text, -- 'match' if actual item matches order condition, 'degraded' if worse
  scan_count integer default 0,
  sort_order integer not null, -- Position within batch for picking sequence
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index pick_lines_batch_idx on pick_lines (pick_batch_id);
create index pick_lines_order_idx on pick_lines (order_line_id);
create index pick_lines_sort_idx on pick_lines (pick_batch_id, sort_order);

-- RLS: scoped by node membership via pick_batches.fulfilment_node_id
alter table pick_batches enable row level security;
alter table pick_lines enable row level security;

create policy pick_batches_select on pick_batches
  for select to authenticated
  using (staff_has_node_access(fulfilment_node_id));

create policy pick_batches_insert on pick_batches
  for insert to authenticated
  with check (staff_has_node_access(fulfilment_node_id));

create policy pick_batches_update on pick_batches
  for update to authenticated
  using (staff_has_node_access(fulfilment_node_id));

create policy pick_lines_select on pick_lines
  for select to authenticated
  using (
    exists (
      select 1 from pick_batches pb
      where pb.id = pick_lines.pick_batch_id
        and staff_has_node_access(pb.fulfilment_node_id)
    )
  );

create policy pick_lines_insert on pick_lines
  for insert to authenticated
  with check (
    exists (
      select 1 from pick_batches pb
      where pb.id = pick_lines.pick_batch_id
        and staff_has_node_access(pb.fulfilment_node_id)
    )
  );

create policy pick_lines_update on pick_lines
  for update to authenticated
  using (
    exists (
      select 1 from pick_batches pb
      where pb.id = pick_lines.pick_batch_id
        and staff_has_node_access(pb.fulfilment_node_id)
    )
  );

-- Helper: create a new pick batch from pending allocations
-- Groups order lines for efficient picking (simplified: no location-based sorting yet)
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

  -- Add pick lines from pending allocations at this node
  -- Sorted by order_id and sku_id for rough efficiency
  insert into pick_lines (
    pick_batch_id, order_line_id, allocation_id, sku_id, quantity_to_pick, sort_order
  )
  select
    v_batch_id,
    ia.order_line_id,
    ia.id,
    ia.sellable_sku_id,
    ia.quantity,
    row_number() over (order by ol.order_id, ia.sellable_sku_id)
  from inventory_allocations ia
  join order_lines ol on ol.id = ia.order_line_id
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

-- Helper: begin picking a batch (transition from pending to in_progress)
create or replace function begin_pick_batch(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch pick_batches;
begin
  select * into v_batch from pick_batches where id = p_batch_id;

  if v_batch is null then
    raise exception 'begin_pick_batch: unknown batch %', p_batch_id;
  end if;

  if not staff_has_node_access(v_batch.fulfilment_node_id) then
    raise exception 'begin_pick_batch: access denied for fulfilment node %', v_batch.fulfilment_node_id
      using errcode = '42501';
  end if;

  if v_batch.status <> 'pending' then
    raise exception 'begin_pick_batch: batch % is %, not pending', p_batch_id, v_batch.status;
  end if;

  update pick_batches
  set status = 'in_progress', started_at = now(), updated_at = now()
  where id = p_batch_id;
end;
$$;

revoke execute on function begin_pick_batch(uuid) from public, anon;
grant execute on function begin_pick_batch(uuid) to authenticated;

-- Helper: complete picking a batch
create or replace function complete_pick_batch(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch pick_batches;
begin
  select * into v_batch from pick_batches where id = p_batch_id;

  if v_batch is null then
    raise exception 'complete_pick_batch: unknown batch %', p_batch_id;
  end if;

  if not staff_has_node_access(v_batch.fulfilment_node_id) then
    raise exception 'complete_pick_batch: access denied for fulfilment node %', v_batch.fulfilment_node_id
      using errcode = '42501';
  end if;

  if v_batch.status <> 'in_progress' then
    raise exception 'complete_pick_batch: batch % is %, not in_progress', p_batch_id, v_batch.status;
  end if;

  update pick_batches
  set status = 'completed', completed_at = now(), completed_by_user_id = auth.uid(), updated_at = now()
  where id = p_batch_id;
end;
$$;

revoke execute on function complete_pick_batch(uuid) from public, anon;
grant execute on function complete_pick_batch(uuid) to authenticated;
