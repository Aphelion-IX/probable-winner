-- quarantined_inventory (blueprint §8.4, backlog Step 7 / B-064). A
-- discrete quarantine record, same pattern as inventory_reservations/
-- inventory_allocations rather than a bare column mutation -- blueprint
-- §8.4 lists quarantined_inventory as its own table, presumably so staff
-- can see *why* a unit is quarantined and *when* it was released, not just
-- the current aggregate count.

create table quarantined_inventory (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  fulfilment_node_id uuid not null references fulfilment_nodes(id) on delete cascade,
  sellable_sku_id uuid not null references sellable_skus(id) on delete cascade,
  quantity integer not null check (quantity > 0),
  reason text not null,
  reference_type text,
  reference_id uuid,
  status text not null default 'quarantined' check (status in ('quarantined', 'released')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  released_at timestamptz
);

create index quarantined_inventory_active_node_sku_idx
  on quarantined_inventory (fulfilment_node_id, sellable_sku_id) where status = 'quarantined';

-- Staff-only for SELECT, same reasoning as inventory_reservations/
-- inventory_allocations.
alter table quarantined_inventory enable row level security;

create policy quarantined_inventory_select on quarantined_inventory
  for select to authenticated
  using (staff_has_node_access(fulfilment_node_id));
