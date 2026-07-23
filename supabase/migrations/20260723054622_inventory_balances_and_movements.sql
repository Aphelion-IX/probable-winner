-- Inventory architecture (blueprint §9.1-§9.2, backlog Step 7 / B-060).
-- inventory_balances is a fast-read current-state table; inventory_movements
-- is the immutable ledger it's derived from. Hard rule 12: balances are never
-- calculated from editable fields or written to directly — only the atomic
-- functions in blueprint §9.3 (receive_inventory(), reserve_inventory(),
-- etc., backlog B-061+) may write either table, inside one transaction with
-- the movement row. No insert/update/delete RLS policy exists for either
-- table here on purpose: until those SECURITY DEFINER functions land, there
-- is no supported write path at all, matching hard rule 2.

create table inventory_balances (
  id uuid primary key default gen_random_uuid(),
  fulfilment_node_id uuid not null references fulfilment_nodes(id) on delete cascade,
  sellable_sku_id uuid not null references sellable_skus(id) on delete cascade,
  quantity_on_hand integer not null default 0 check (quantity_on_hand >= 0),
  quantity_reserved integer not null default 0 check (quantity_reserved >= 0),
  quantity_allocated integer not null default 0 check (quantity_allocated >= 0),
  quantity_picking integer not null default 0 check (quantity_picking >= 0),
  quantity_quarantined integer not null default 0 check (quantity_quarantined >= 0),
  quantity_safety_stock integer not null default 0 check (quantity_safety_stock >= 0),
  quantity_available_online integer not null default 0 check (quantity_available_online >= 0),
  updated_at timestamptz not null default now(),
  -- Named to match the index list in blueprint §21 / backlog B-066; the
  -- other two indexes named there (inventory_balance_sku_node_idx,
  -- inventory_available_node_idx) are added by B-066 once the queries that
  -- justify them (B-084/B-102) exist to EXPLAIN against.
  constraint inventory_balance_node_sku_uq unique (fulfilment_node_id, sellable_sku_id)
);

create table inventory_movements (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  fulfilment_node_id uuid not null references fulfilment_nodes(id) on delete cascade,
  sellable_sku_id uuid not null references sellable_skus(id) on delete cascade,
  movement_type text not null check (movement_type in (
    'receive', 'sale', 'reserve', 'release_reservation', 'allocate',
    'begin_picking', 'complete_picking', 'transfer_out', 'transfer_in',
    'damage', 'quarantine', 'stocktake_adjustment', 'return', 'buylist_acquisition'
  )),
  -- Signed change applied to the relevant inventory_balances quantity
  -- column(s) — not constrained non-negative, since e.g. a sale or
  -- transfer_out is a negative delta by definition.
  quantity_delta integer not null,
  reference_type text,
  reference_id uuid,
  staff_user_id uuid references auth.users(id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);

create index inventory_movements_node_sku_idx on inventory_movements (fulfilment_node_id, sellable_sku_id);
create index inventory_movements_org_idx on inventory_movements (organisation_id);
create index inventory_movements_reference_idx on inventory_movements (reference_type, reference_id);
