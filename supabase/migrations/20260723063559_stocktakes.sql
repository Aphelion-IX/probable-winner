-- stocktakes/stocktake_lines (blueprint §8.4, backlog Step 7 / B-065).
-- Counting (creating/updating lines, setting counted_quantity) is ordinary
-- staff data entry against these two tables directly -- unlike
-- inventory_balances/movements, these aren't part of the protected ledger,
-- they're a worksheet. The protected step is reconciliation: turning a
-- variance into an actual inventory_movements row, which only ever happens
-- via adjust_inventory() (backlog B-061), run from the worker
-- (backlog B-065's background job, per blueprint §2.5's "stock
-- reconciliation" being explicitly listed as background-only work), never
-- a direct inventory_balances edit.

create table stocktakes (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  fulfilment_node_id uuid not null references fulfilment_nodes(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'in_progress', 'completed', 'reconciled')),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index stocktakes_node_idx on stocktakes (fulfilment_node_id);

create table stocktake_lines (
  id uuid primary key default gen_random_uuid(),
  stocktake_id uuid not null references stocktakes(id) on delete cascade,
  fulfilment_node_id uuid not null references fulfilment_nodes(id) on delete cascade,
  sellable_sku_id uuid not null references sellable_skus(id) on delete cascade,
  expected_quantity integer not null check (expected_quantity >= 0),
  counted_quantity integer check (counted_quantity >= 0),
  variance integer generated always as (counted_quantity - expected_quantity) stored,
  reconciled boolean not null default false,
  adjustment_movement_id uuid references inventory_movements(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (stocktake_id, sellable_sku_id)
);

create index stocktake_lines_stocktake_idx on stocktake_lines (stocktake_id);
create index stocktake_lines_unreconciled_idx
  on stocktake_lines (stocktake_id) where reconciled = false and counted_quantity is not null;

-- Staff-scoped read/write -- counting is a direct staff action, not routed
-- through an atomic function (only the reconciliation step is).
alter table stocktakes enable row level security;
alter table stocktake_lines enable row level security;

create policy stocktakes_select on stocktakes
  for select to authenticated
  using (staff_has_node_access(fulfilment_node_id));
create policy stocktakes_insert on stocktakes
  for insert to authenticated
  with check (staff_has_node_access(fulfilment_node_id));
create policy stocktakes_update on stocktakes
  for update to authenticated
  using (staff_has_node_access(fulfilment_node_id))
  with check (staff_has_node_access(fulfilment_node_id));

create policy stocktake_lines_select on stocktake_lines
  for select to authenticated
  using (staff_has_node_access(fulfilment_node_id));
create policy stocktake_lines_insert on stocktake_lines
  for insert to authenticated
  with check (staff_has_node_access(fulfilment_node_id));
create policy stocktake_lines_update on stocktake_lines
  for update to authenticated
  using (staff_has_node_access(fulfilment_node_id))
  with check (staff_has_node_access(fulfilment_node_id));

-- "The web request should enqueue the work and return quickly" (blueprint
-- §2.5): staff marking a stocktake completed (a plain UPDATE, no atomic
-- function needed since this is worksheet metadata, not the ledger) is
-- what triggers reconciliation -- this trigger does the enqueueing so the
-- staff-facing update itself stays a fast, ordinary write.
-- security definer: `authenticated` has no USAGE on the pgmq schema
-- (verified directly against the remote project -- calling pgmq.send()
-- as authenticated fails with "permission denied for schema pgmq"), so
-- this must run as the function owner to actually enqueue.
create or replace function enqueue_stock_reconciliation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    perform pgmq.send('stock_reconciliation', jsonb_build_object('stocktakeId', new.id));
  end if;
  return new;
end;
$$;

create trigger stocktakes_enqueue_reconciliation
  after update on stocktakes
  for each row
  execute function enqueue_stock_reconciliation();
