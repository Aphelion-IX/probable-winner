-- Fix a latent bug found while wiring up the search_index consumer (B-083):
-- publish_suggested_price()/set_price_override()/clear_price_override()
-- (20260723082400_published_prices_and_overrides.sql) insert directly into
-- integration_events using columns (aggregate_id, aggregate_type,
-- event_type, event_data) — but the real table
-- (20260723065043_integration_events_outbox.sql) has
-- (organisation_id not null, event_type, aggregate_type, aggregate_id,
-- payload); there is no event_data column. Every call to any of these three
-- functions has been throwing at the final insert since the table was
-- created, and even if the column name were fixed, a raw insert here would
-- never enqueue a search_index message (only emit_integration_event() does
-- that), so a price publish would never reach the search index either way.
--
-- Fix: route all three through emit_integration_event(), the same outbox
-- helper every other atomic function already uses (blueprint §13.3).

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

  perform emit_integration_event(
    v_published.organisation_id,
    'pricing_published',
    'published_price',
    v_published.id,
    jsonb_build_object(
      'publishedPriceId', v_published.id,
      'sellableSkuId', v_published.sellable_sku_id,
      'finalAmount', v_published.final_amount,
      'currency', v_published.currency,
      'publishedAt', now()
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

  perform emit_integration_event(
    v_published.organisation_id,
    'pricing_override_set',
    'published_price',
    published_price_id,
    jsonb_build_object(
      'publishedPriceId', published_price_id,
      'sellableSkuId', v_published.sellable_sku_id,
      'fulfilmentNodeId', fulfilment_node_id,
      'overrideAmount', override_amount,
      'reason', reason,
      'setAt', now()
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

  perform emit_integration_event(
    v_published.organisation_id,
    'pricing_override_cleared',
    'published_price',
    published_price_id,
    jsonb_build_object(
      'publishedPriceId', published_price_id,
      'sellableSkuId', v_published.sellable_sku_id,
      'fulfilmentNodeId', fulfilment_node_id,
      'clearedAt', now()
    )
  );

  return jsonb_build_object(
    'id', published_price_id,
    'fulfilment_node_id', fulfilment_node_id,
    'status', 'override_cleared'
  );
end;
$$ language plpgsql security definer;
