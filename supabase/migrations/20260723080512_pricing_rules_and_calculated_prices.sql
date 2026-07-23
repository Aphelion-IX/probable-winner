-- pricing_rules / calculated_prices (blueprint §15, §17, backlog B-160).
-- Schema only -- the calculation function that actually writes
-- calculated_prices rows is B-161, a separate backlog item; this migration
-- has no write policy/function yet, same as how B-070's transfer schema
-- landed before B-071's dispatch/receive functions.
--
-- A pricing_rule is a named, reusable configuration (per organisation, not
-- per SKU): which source price type to base a suggestion on, a target
-- currency, and a margin. Condition- and stock-based modifiers are
-- separate one-to-many tables (a rule can have zero or more of each) so a
-- rule isn't forced to define every condition/quantity band up front.
create table pricing_rules (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  priority integer not null default 100,
  source_price_type text not null default 'market' check (source_price_type in ('market', 'low', 'retail', 'buylist', 'recent_sale')),
  target_currency text not null default 'AUD',
  margin_type text not null default 'percentage' check (margin_type in ('percentage', 'flat')),
  margin_value numeric(12, 4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, name)
);

create index pricing_rules_org_idx on pricing_rules (organisation_id);

-- e.g. LP = 85% of the NM base price. One row per condition per rule --
-- a condition with no row here gets no condition adjustment.
create table pricing_condition_modifiers (
  id uuid primary key default gen_random_uuid(),
  pricing_rule_id uuid not null references pricing_rules(id) on delete cascade,
  condition text not null check (condition in ('NM', 'LP', 'MP', 'HP', 'DMG')),
  modifier_type text not null check (modifier_type in ('percentage', 'flat')),
  modifier_value numeric(12, 4) not null,
  created_at timestamptz not null default now(),
  unique (pricing_rule_id, condition)
);

-- e.g. dump the price 10% once on-hand stock exceeds 20 units; a null
-- max_quantity means "and above" (open-ended top band).
create table pricing_stock_modifiers (
  id uuid primary key default gen_random_uuid(),
  pricing_rule_id uuid not null references pricing_rules(id) on delete cascade,
  min_quantity integer not null check (min_quantity >= 0),
  max_quantity integer check (max_quantity is null or max_quantity >= min_quantity),
  modifier_type text not null check (modifier_type in ('percentage', 'flat')),
  modifier_value numeric(12, 4) not null,
  created_at timestamptz not null default now()
);

create index pricing_stock_modifiers_rule_idx on pricing_stock_modifiers (pricing_rule_id);

-- One row per (rule, sku) calculation run. Not immutable like
-- price_snapshots -- status transitions (suggested -> approved/rejected)
-- are the point of B-162/163's review workflow, so this table is written
-- by more than an initial insert, unlike the price ledger it's built from.
-- Every component of the final amount is stored, not just the total, so
-- staff can explain any price from this row alone (blueprint §17 "done"
-- criterion) without recomputing.
create table calculated_prices (
  id uuid primary key default gen_random_uuid(),
  pricing_rule_id uuid not null references pricing_rules(id) on delete cascade,
  sellable_sku_id uuid not null references sellable_skus(id) on delete cascade,
  base_amount numeric(12, 2) not null check (base_amount >= 0),
  base_currency text not null,
  exchange_rate numeric(14, 6) not null default 1 check (exchange_rate > 0),
  margin_amount numeric(12, 2) not null default 0,
  condition_modifier_amount numeric(12, 2) not null default 0,
  stock_modifier_amount numeric(12, 2) not null default 0,
  final_amount numeric(12, 2) not null check (final_amount >= 0),
  currency text not null,
  status text not null default 'suggested' check (status in ('suggested', 'approved', 'rejected')),
  calculated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index calculated_prices_sku_idx on calculated_prices (sellable_sku_id, calculated_at desc);
create index calculated_prices_rule_idx on calculated_prices (pricing_rule_id);
create index calculated_prices_status_idx on calculated_prices (status);

-- Traceability (blueprint §17 "done" criterion continued): the specific
-- price_snapshots rows that fed a calculation -- a many-to-many join
-- because a suggestion can blend more than one provider's observation
-- (e.g. to run the "provider disagreement" anomaly check in B-162).
create table calculated_price_inputs (
  id uuid primary key default gen_random_uuid(),
  calculated_price_id uuid not null references calculated_prices(id) on delete cascade,
  price_snapshot_id uuid not null references price_snapshots(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (calculated_price_id, price_snapshot_id)
);

create index calculated_price_inputs_price_idx on calculated_price_inputs (calculated_price_id);
