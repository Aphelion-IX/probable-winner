-- Store transfer schema (blueprint §8.5/§12, backlog Step 8 / B-070).
-- Full status lifecycle: Draft -> Requested -> Accepted -> Picking ->
-- Dispatched -> In transit -> Partially received -> Received, plus
-- Cancelled (only reachable before dispatch -- once stock has physically
-- left the source node there's no "undo", matching real-world transfers).
--
-- Only dispatch and receipt touch inventory_balances (backlog B-071); the
-- earlier workflow states (requested/accepted/picking) are plain staff
-- status updates with no inventory effect, same reasoning as stocktakes'
-- counting phase (migration 20260723063559) -- the enforce_transfer_
-- status_transition() trigger below is what keeps those plain updates
-- honest, e.g. rejecting Draft -> Received directly.

create table transfer_orders (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  source_fulfilment_node_id uuid not null references fulfilment_nodes(id) on delete cascade,
  destination_fulfilment_node_id uuid not null references fulfilment_nodes(id) on delete cascade,
  status text not null default 'draft' check (status in (
    'draft', 'requested', 'accepted', 'picking', 'dispatched',
    'in_transit', 'partially_received', 'received', 'cancelled'
  )),
  notes text,
  requested_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transfer_orders_distinct_nodes check (source_fulfilment_node_id <> destination_fulfilment_node_id)
);

create index transfer_orders_source_idx on transfer_orders (source_fulfilment_node_id);
create index transfer_orders_destination_idx on transfer_orders (destination_fulfilment_node_id);

create table transfer_order_lines (
  id uuid primary key default gen_random_uuid(),
  transfer_order_id uuid not null references transfer_orders(id) on delete cascade,
  sellable_sku_id uuid not null references sellable_skus(id) on delete cascade,
  quantity_requested integer not null check (quantity_requested > 0),
  created_at timestamptz not null default now(),
  unique (transfer_order_id, sellable_sku_id)
);

create index transfer_order_lines_transfer_idx on transfer_order_lines (transfer_order_id);

-- One row per dispatch event. Blueprint doesn't describe partial dispatch
-- (unlike partial receipt), so a transfer order dispatches as one shipment
-- covering every line's full quantity_requested.
create table transfer_shipments (
  id uuid primary key default gen_random_uuid(),
  transfer_order_id uuid not null references transfer_orders(id) on delete cascade,
  dispatched_by uuid references auth.users(id) on delete set null,
  dispatched_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index transfer_shipments_transfer_idx on transfer_shipments (transfer_order_id);

-- One row per (line, receiving session) -- multiple rows per line across
-- multiple partial-receipt sessions are expected (backlog B-072).
create table transfer_receipts (
  id uuid primary key default gen_random_uuid(),
  transfer_order_id uuid not null references transfer_orders(id) on delete cascade,
  transfer_shipment_id uuid not null references transfer_shipments(id) on delete cascade,
  sellable_sku_id uuid not null references sellable_skus(id) on delete cascade,
  quantity_good integer not null default 0 check (quantity_good >= 0),
  quantity_damaged integer not null default 0 check (quantity_damaged >= 0),
  quantity_missing integer not null default 0 check (quantity_missing >= 0),
  received_by uuid references auth.users(id) on delete set null,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint transfer_receipts_nonzero check (quantity_good + quantity_damaged + quantity_missing > 0)
);

create index transfer_receipts_transfer_idx on transfer_receipts (transfer_order_id);
create index transfer_receipts_shipment_idx on transfer_receipts (transfer_shipment_id);

create or replace function enforce_transfer_status_transition()
returns trigger
language plpgsql
as $$
declare
  v_allowed boolean;
begin
  if new.status = old.status then
    return new;
  end if;

  v_allowed := (old.status, new.status) in (
    ('draft', 'requested'), ('draft', 'cancelled'),
    ('requested', 'accepted'), ('requested', 'cancelled'),
    ('accepted', 'picking'), ('accepted', 'cancelled'),
    ('picking', 'dispatched'), ('picking', 'cancelled'),
    ('dispatched', 'in_transit'),
    -- receive_transfer() can fully or partially reconcile a transfer the
    -- moment it's dispatched, without requiring a separate "mark in
    -- transit" step first -- so both dispatched and in_transit can lead
    -- directly to partially_received or received.
    ('dispatched', 'partially_received'), ('dispatched', 'received'),
    ('in_transit', 'partially_received'), ('in_transit', 'received'),
    ('partially_received', 'partially_received'),
    ('partially_received', 'received')
  );

  if not v_allowed then
    raise exception 'transfer_orders: invalid status transition % -> %', old.status, new.status
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger transfer_orders_enforce_status_transition
  before update on transfer_orders
  for each row
  execute function enforce_transfer_status_transition();

alter table transfer_orders enable row level security;
alter table transfer_order_lines enable row level security;
alter table transfer_shipments enable row level security;
alter table transfer_receipts enable row level security;

-- Visible to staff scoped to either the source or the destination node.
create policy transfer_orders_select on transfer_orders
  for select to authenticated
  using (staff_has_node_access(source_fulfilment_node_id) or staff_has_node_access(destination_fulfilment_node_id));
create policy transfer_orders_insert on transfer_orders
  for insert to authenticated
  with check (staff_has_node_access(source_fulfilment_node_id) or staff_has_node_access(destination_fulfilment_node_id));
create policy transfer_orders_update on transfer_orders
  for update to authenticated
  using (staff_has_node_access(source_fulfilment_node_id) or staff_has_node_access(destination_fulfilment_node_id))
  with check (staff_has_node_access(source_fulfilment_node_id) or staff_has_node_access(destination_fulfilment_node_id));

create policy transfer_order_lines_select on transfer_order_lines
  for select to authenticated
  using (exists (
    select 1 from transfer_orders t where t.id = transfer_order_lines.transfer_order_id
      and (staff_has_node_access(t.source_fulfilment_node_id) or staff_has_node_access(t.destination_fulfilment_node_id))
  ));
create policy transfer_order_lines_insert on transfer_order_lines
  for insert to authenticated
  with check (exists (
    select 1 from transfer_orders t where t.id = transfer_order_lines.transfer_order_id
      and (staff_has_node_access(t.source_fulfilment_node_id) or staff_has_node_access(t.destination_fulfilment_node_id))
  ));

create policy transfer_shipments_select on transfer_shipments
  for select to authenticated
  using (exists (
    select 1 from transfer_orders t where t.id = transfer_shipments.transfer_order_id
      and (staff_has_node_access(t.source_fulfilment_node_id) or staff_has_node_access(t.destination_fulfilment_node_id))
  ));

create policy transfer_receipts_select on transfer_receipts
  for select to authenticated
  using (exists (
    select 1 from transfer_orders t where t.id = transfer_receipts.transfer_order_id
      and (staff_has_node_access(t.source_fulfilment_node_id) or staff_has_node_access(t.destination_fulfilment_node_id))
  ));
