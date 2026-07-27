-- Fixes B-165's actual AC ("publishing a price writes an integration event
-- consumed by the same outbox path as inventory changes... an integration
-- test: publishing a price updates the Typesense document's price
-- fields") -- which was never true. publish_suggested_price(),
-- set_price_override(), and clear_price_override() (most recently
-- redefined by 20260726000000_require_pricing_permissions_on_publish_and_override.sql)
-- each wrote their own raw `insert into integration_events(...)` instead of
-- calling emit_integration_event(), so none of them ever called
-- pgmq.send('search_index', ...) -- a published/overridden price never
-- reached the search_index queue, meaning Typesense's price fields never
-- updated on a price change. The payload keys were also snake_case
-- (sellable_sku_id) while search-index-consumer.ts's extractSkuId() reads
-- payload.sellableSkuId (camelCase) -- a second, independent reason the
-- consumer could never have resolved a sku from these events even if a
-- message had been sent.
--
-- This also affects 20260727020000_enqueue_restock_and_price_alert_checks.sql's
-- price-alert check: that migration added a standalone pgmq.send() call
-- inside publish_suggested_price() as a workaround for it not going
-- through emit_integration_event(). Since publish_suggested_price() is
-- rewritten here to call emit_integration_event() (which is extended below
-- to send the same restock_alerts price-check message for a
-- 'pricing_published' event), that standalone call is removed to avoid
-- double-enqueuing -- one pricing_published event now produces exactly one
-- search_index message and exactly one restock_alerts message, the same
-- 1:1 shape every inventory function's event already has.
--
-- set_price_override()/clear_price_override() are fixed the same way for
-- search_index sync (a store override changing the effective price should
-- also refresh that SKU's document), but do NOT trigger a restock_alerts
-- price-check message -- price_alerts has no store scope, so it checks
-- against the central published price only (the 'pricing_published' event),
-- not a single store's override.

create or replace function emit_integration_event(
  p_organisation_id uuid,
  p_event_type text,
  p_aggregate_type text,
  p_aggregate_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
begin
  insert into integration_events (organisation_id, event_type, aggregate_type, aggregate_id, payload)
  values (p_organisation_id, p_event_type, p_aggregate_type, p_aggregate_id, p_payload)
  returning id into v_event_id;

  perform pgmq.send('search_index', jsonb_build_object('integrationEventId', v_event_id, 'eventType', p_event_type));

  if p_event_type = 'inventory_balance_changed' then
    perform pgmq.send('restock_alerts', jsonb_build_object(
      'checkType', 'restock',
      'integrationEventId', v_event_id,
      'sellableSkuId', p_payload ->> 'sellableSkuId'
    ));
  elsif p_event_type = 'pricing_published' then
    perform pgmq.send('restock_alerts', jsonb_build_object(
      'checkType', 'price',
      'integrationEventId', v_event_id,
      'sellableSkuId', p_payload ->> 'sellableSkuId',
      'finalAmount', (p_payload ->> 'finalAmount')::numeric,
      'currency', p_payload ->> 'currency'
    ));
  end if;

  return v_event_id;
end;
$$;

revoke execute on function emit_integration_event(uuid, text, text, uuid, jsonb) from public, anon, authenticated;

-- Bodies below are reproduced from 20260726000000 verbatim (same
-- permission check, same validation, same return shape) except: the raw
-- integration_events insert is replaced with a call to
-- emit_integration_event(), and its payload keys are camelCase so
-- search-index-consumer.ts's extractSkuId() can actually read
-- sellableSkuId. CREATE OR REPLACE cannot rename the existing parameters,
-- so signatures are unchanged.

create or replace function publish_suggested_price(calculated_price_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_calc record;
  v_rule record;
  v_published record;
begin
  if not staff_has_permission('pricing.approve') then
    raise exception 'publish_suggested_price: pricing.approve permission required'
      using errcode = '42501';
  end if;

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
    v_published.organisation_id, 'pricing_published', 'published_price', v_published.id,
    jsonb_build_object(
      'publishedPriceId', v_published.id,
      'sellableSkuId', v_published.sellable_sku_id,
      'finalAmount', v_published.final_amount,
      'currency', v_published.currency,
      'organisationId', v_published.organisation_id,
      'publishedAt', now()
    )
  );

  perform record_audit_event(
    v_published.organisation_id, 'pricing.publish', 'published_price', v_published.id,
    jsonb_build_object(
      'sellableSkuId', v_published.sellable_sku_id, 'finalAmount', v_published.final_amount,
      'currency', v_published.currency, 'calculatedPriceId', calculated_price_id
    )
  );

  return jsonb_build_object(
    'id', v_published.id,
    'final_amount', v_published.final_amount,
    'currency', v_published.currency,
    'status', 'published'
  );
end;
$$;

create or replace function set_price_override(
  p_published_price_id uuid,
  p_fulfilment_node_id uuid,
  p_override_amount numeric,
  p_reason text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_published record;
  v_override record;
begin
  if not staff_has_permission('pricing.override') then
    raise exception 'set_price_override: pricing.override permission required'
      using errcode = '42501';
  end if;

  if p_override_amount < 0 then
    raise exception 'override amount cannot be negative: %', p_override_amount;
  end if;

  select * into v_published from published_prices where id = p_published_price_id;
  if v_published is null then
    raise exception 'published_price not found: %', p_published_price_id;
  end if;

  if not exists (
    select 1 from fulfilment_nodes fn
    where fn.id = p_fulfilment_node_id and fn.organisation_id = v_published.organisation_id
  ) then
    raise exception 'fulfilment_node % not found in organisation %',
      p_fulfilment_node_id, v_published.organisation_id;
  end if;

  insert into published_price_overrides (
    published_price_id, fulfilment_node_id, override_amount, reason
  )
  values (p_published_price_id, p_fulfilment_node_id, p_override_amount, p_reason)
  on conflict (published_price_id, fulfilment_node_id) do update
  set
    override_amount = excluded.override_amount,
    reason = excluded.reason,
    updated_at = now()
  returning * into v_override;

  perform emit_integration_event(
    v_published.organisation_id, 'pricing_override_set', 'published_price', p_published_price_id,
    jsonb_build_object(
      'publishedPriceId', p_published_price_id,
      'sellableSkuId', v_published.sellable_sku_id,
      'fulfilmentNodeId', p_fulfilment_node_id,
      'overrideAmount', p_override_amount,
      'reason', p_reason,
      'setAt', now()
    )
  );

  perform record_audit_event(
    v_published.organisation_id, 'pricing.set_override', 'published_price_override', v_override.id,
    jsonb_build_object(
      'publishedPriceId', p_published_price_id, 'fulfilmentNodeId', p_fulfilment_node_id,
      'overrideAmount', p_override_amount, 'reason', p_reason
    )
  );

  return jsonb_build_object(
    'id', v_override.id,
    'published_price_id', p_published_price_id,
    'fulfilment_node_id', p_fulfilment_node_id,
    'override_amount', p_override_amount
  );
end;
$$;

create or replace function clear_price_override(
  p_published_price_id uuid,
  p_fulfilment_node_id uuid
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_published record;
  v_override record;
begin
  if not staff_has_permission('pricing.override') then
    raise exception 'clear_price_override: pricing.override permission required'
      using errcode = '42501';
  end if;

  select * into v_published from published_prices where id = p_published_price_id;
  if v_published is null then
    raise exception 'published_price not found: %', p_published_price_id;
  end if;

  select * into v_override from published_price_overrides
    where published_price_id = p_published_price_id
      and fulfilment_node_id = p_fulfilment_node_id;

  if v_override is null then
    raise exception 'no override found for published_price % at node %',
      p_published_price_id, p_fulfilment_node_id;
  end if;

  delete from published_price_overrides
    where published_price_id = p_published_price_id
      and fulfilment_node_id = p_fulfilment_node_id;

  perform emit_integration_event(
    v_published.organisation_id, 'pricing_override_cleared', 'published_price', p_published_price_id,
    jsonb_build_object(
      'publishedPriceId', p_published_price_id,
      'sellableSkuId', v_published.sellable_sku_id,
      'fulfilmentNodeId', p_fulfilment_node_id,
      'clearedAt', now()
    )
  );

  perform record_audit_event(
    v_published.organisation_id, 'pricing.clear_override', 'published_price_override', v_override.id,
    jsonb_build_object('publishedPriceId', p_published_price_id, 'fulfilmentNodeId', p_fulfilment_node_id)
  );

  return jsonb_build_object(
    'id', p_published_price_id,
    'fulfilment_node_id', p_fulfilment_node_id,
    'status', 'override_cleared'
  );
end;
$$;
