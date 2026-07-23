-- Price book publication with store overrides (backlog B-164).
-- Central price book (published_prices) with optional per-store overrides.
-- Do not duplicate prices for every store — store overrides are sparse and applied
-- on-demand. Emits integration events for reindex trigger (B-165).

create table published_prices (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  pricing_rule_id uuid not null references pricing_rules(id) on delete cascade,
  sellable_sku_id uuid not null references sellable_skus(id) on delete cascade,
  calculated_price_id uuid not null references calculated_prices(id),
  final_amount numeric(12, 2) not null check (final_amount >= 0),
  currency text not null,
  status text not null default 'active' check (status in ('active', 'archived', 'suspended')),
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sellable_sku_id, organisation_id, currency)
);

create index published_prices_sku_idx on published_prices (sellable_sku_id);
create index published_prices_org_idx on published_prices (organisation_id);
create index published_prices_rule_idx on published_prices (pricing_rule_id);
create index published_prices_status_idx on published_prices (status);

-- Per-store price overrides: sparse, applied on top of published_prices.
-- A fulfilment_node can have at most one override per published_price.
create table published_price_overrides (
  id uuid primary key default gen_random_uuid(),
  published_price_id uuid not null references published_prices(id) on delete cascade,
  fulfilment_node_id uuid not null references fulfilment_nodes(id) on delete cascade,
  override_amount numeric(12, 2) not null check (override_amount >= 0),
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (published_price_id, fulfilment_node_id)
);

create index published_price_overrides_price_idx on published_price_overrides (published_price_id);
create index published_price_overrides_node_idx on published_price_overrides (fulfilment_node_id);

-- RLS: staff-only read, no direct writes (functions below are the only writers).
alter table published_prices enable row level security;
alter table published_price_overrides enable row level security;

create policy published_prices_select on published_prices
  for select to authenticated
  using (staff_has_org_access(organisation_id));

create policy published_price_overrides_select on published_price_overrides
  for select to authenticated
  using (
    exists (
      select 1 from published_prices pp
      where pp.id = published_price_overrides.published_price_id
        and staff_has_org_access(pp.organisation_id)
    )
  );

-- Publish an approved calculated price into the central price book.
-- Only callable when the calculated price is in 'approved' status.
-- Emits a pricing_published event for downstream reindex (B-165).
create or replace function publish_suggested_price(
  calculated_price_id uuid
) returns json as $$
declare
  v_calc record;
  v_rule record;
  v_published record;
begin
  select cp.* into v_calc from calculated_prices cp where cp.id = calculated_price_id;
  if v_calc is null then
    raise exception 'calculated_price not found: %', calculated_price_id;
  end if;

  if v_calc.status != 'approved' then
    raise exception 'can only publish approved prices, current status: %', v_calc.status;
  end if;

  select * into v_rule from pricing_rules where id = v_calc.pricing_rule_id;
  if v_rule is null then
    raise exception 'pricing_rule not found: %', v_calc.pricing_rule_id;
  end if;

  -- Insert or update the published price (upsert).
  insert into published_prices (
    organisation_id, pricing_rule_id, sellable_sku_id, calculated_price_id,
    final_amount, currency, status
  )
  values (
    v_rule.organisation_id, v_rule.id, v_calc.sellable_sku_id, calculated_price_id,
    v_calc.final_amount, v_calc.currency, 'active'
  )
  on conflict (sellable_sku_id, organisation_id, currency) do update
  set
    calculated_price_id = excluded.calculated_price_id,
    final_amount = excluded.final_amount,
    status = 'active',
    updated_at = now()
  returning * into v_published;

  -- Emit integration event for reindex (B-165).
  insert into integration_events (aggregate_id, aggregate_type, event_type, event_data)
    values (
      v_published.id,
      'published_price',
      'pricing_published',
      jsonb_build_object(
        'published_price_id', v_published.id,
        'sellable_sku_id', v_published.sellable_sku_id,
        'final_amount', v_published.final_amount,
        'currency', v_published.currency,
        'organisation_id', v_published.organisation_id,
        'published_at', now()
      )
    );

  return jsonb_build_object(
    'id', v_published.id,
    'final_amount', v_published.final_amount,
    'currency', v_published.currency,
    'status', 'published'
  );
end;
$$ language plpgsql security definer;

-- Set or update a store-specific price override.
-- Creates or updates an override row for the given store and published price.
-- Emits a pricing_override_set event for audit and potential reindex.
create or replace function set_price_override(
  published_price_id uuid,
  fulfilment_node_id uuid,
  override_amount numeric,
  reason text default null
) returns json as $$
declare
  v_published record;
  v_override record;
begin
  if override_amount < 0 then
    raise exception 'override amount cannot be negative: %', override_amount;
  end if;

  select * into v_published from published_prices where id = published_price_id;
  if v_published is null then
    raise exception 'published_price not found: %', published_price_id;
  end if;

  -- Verify the fulfilment_node exists and belongs to the same organisation.
  if not exists (
    select 1 from fulfilment_nodes fn
    where fn.id = fulfilment_node_id and fn.organisation_id = v_published.organisation_id
  ) then
    raise exception 'fulfilment_node % not found in organisation %',
      fulfilment_node_id, v_published.organisation_id;
  end if;

  insert into published_price_overrides (
    published_price_id, fulfilment_node_id, override_amount, reason
  )
  values (published_price_id, fulfilment_node_id, override_amount, reason)
  on conflict (published_price_id, fulfilment_node_id) do update
  set
    override_amount = excluded.override_amount,
    reason = excluded.reason,
    updated_at = now()
  returning * into v_override;

  insert into integration_events (aggregate_id, aggregate_type, event_type, event_data)
    values (
      published_price_id,
      'published_price',
      'pricing_override_set',
      jsonb_build_object(
        'published_price_id', published_price_id,
        'fulfilment_node_id', fulfilment_node_id,
        'override_amount', override_amount,
        'reason', reason,
        'set_at', now()
      )
    );

  return jsonb_build_object(
    'id', v_override.id,
    'published_price_id', published_price_id,
    'fulfilment_node_id', fulfilment_node_id,
    'override_amount', override_amount
  );
end;
$$ language plpgsql security definer;

-- Clear a store-specific price override (revert to central price).
-- Deletes the override row for the given store and published price.
-- Emits a pricing_override_cleared event.
create or replace function clear_price_override(
  published_price_id uuid,
  fulfilment_node_id uuid
) returns json as $$
declare
  v_published record;
begin
  select * into v_published from published_prices where id = published_price_id;
  if v_published is null then
    raise exception 'published_price not found: %', published_price_id;
  end if;

  if not exists (
    select 1 from published_price_overrides
    where published_price_id = published_price_id
      and fulfilment_node_id = fulfilment_node_id
  ) then
    raise exception 'no override found for published_price % at node %',
      published_price_id, fulfilment_node_id;
  end if;

  delete from published_price_overrides
    where published_price_id = published_price_id
      and fulfilment_node_id = fulfilment_node_id;

  insert into integration_events (aggregate_id, aggregate_type, event_type, event_data)
    values (
      published_price_id,
      'published_price',
      'pricing_override_cleared',
      jsonb_build_object(
        'published_price_id', published_price_id,
        'fulfilment_node_id', fulfilment_node_id,
        'cleared_at', now()
      )
    );

  return jsonb_build_object(
    'id', published_price_id,
    'fulfilment_node_id', fulfilment_node_id,
    'status', 'override_cleared'
  );
end;
$$ language plpgsql security definer;
