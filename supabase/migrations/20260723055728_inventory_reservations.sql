-- inventory_reservations (blueprint §8.4/§10, backlog Step 7 / B-062).
-- cart_id is deliberately NOT a foreign key yet: the carts table doesn't
-- exist until backlog B-110 (Phase 2, Step 12), which itself depends on
-- this table existing. A future migration adds
-- `references carts(id)` once B-110 lands.

create table inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  fulfilment_node_id uuid not null references fulfilment_nodes(id) on delete cascade,
  sellable_sku_id uuid not null references sellable_skus(id) on delete cascade,
  cart_id uuid,
  quantity integer not null check (quantity > 0),
  status text not null default 'active' check (status in ('active', 'converted', 'released', 'expired', 'cancelled')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Partial indexes: only active reservations matter for availability checks
-- and the expiry sweep (backlog B-112); terminal-status rows are historical.
create index inventory_reservations_active_node_sku_idx
  on inventory_reservations (fulfilment_node_id, sellable_sku_id) where status = 'active';
create index inventory_reservations_active_expires_idx
  on inventory_reservations (expires_at) where status = 'active';
create index inventory_reservations_cart_idx on inventory_reservations (cart_id);

-- Staff-only for now, same reasoning as inventory_balances/inventory_movements
-- (migration 20260723054635): a future migration adds a customer-facing
-- policy scoped by carts.user_id/session once B-110 creates that
-- ownership link.
alter table inventory_reservations enable row level security;

create policy inventory_reservations_select on inventory_reservations
  for select to authenticated
  using (staff_has_node_access(fulfilment_node_id));
