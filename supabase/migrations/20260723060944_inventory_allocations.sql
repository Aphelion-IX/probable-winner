-- inventory_allocations (blueprint §8.4, backlog Step 7 / B-063). An
-- allocation is what a reservation becomes once payment confirms it
-- (blueprint §16: "Reservations converted to allocations"). order_line_id
-- is deliberately NOT a foreign key yet, same reasoning as
-- inventory_reservations.cart_id: orders don't exist until backlog B-120s
-- (Phase 3), which depend on this table, not the other way around.

create table inventory_allocations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  fulfilment_node_id uuid not null references fulfilment_nodes(id) on delete cascade,
  sellable_sku_id uuid not null references sellable_skus(id) on delete cascade,
  inventory_reservation_id uuid references inventory_reservations(id),
  order_line_id uuid,
  quantity integer not null check (quantity > 0),
  status text not null default 'allocated' check (status in ('allocated', 'picking', 'picked', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index inventory_allocations_node_sku_idx on inventory_allocations (fulfilment_node_id, sellable_sku_id);
create index inventory_allocations_order_line_idx on inventory_allocations (order_line_id);
create index inventory_allocations_reservation_idx on inventory_allocations (inventory_reservation_id);

-- Staff-only for SELECT, same reasoning as inventory_reservations: a future
-- migration adds customer-facing visibility once orders (B-120s) exist.
alter table inventory_allocations enable row level security;

create policy inventory_allocations_select on inventory_allocations
  for select to authenticated
  using (staff_has_node_access(fulfilment_node_id));
