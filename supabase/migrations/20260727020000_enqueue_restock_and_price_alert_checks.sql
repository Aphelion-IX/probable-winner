-- Wires up the notification half of restock/price alerts (backlog B-192).
-- price_alerts/restock_alerts (migration 20260724130000) let a customer
-- create an alert, but until now nothing ever enqueued a check against
-- them -- an alert sat at status='active' forever, regardless of stock or
-- price movement. Per B-192's AC, the trigger must go through the queue
-- (never inline in the receiving request handler), so this reuses the
-- existing outbox: emit_integration_event() already fires for every
-- inventory-affecting atomic function (receive/adjust/reserve/release/
-- allocate/pick/quarantine/transfer), so an 'inventory_balance_changed'
-- event is exactly the "something for this SKU changed, go re-check" signal
-- restock alerts need -- no per-function changes required.
--
-- publish_suggested_price() does not route through emit_integration_event()
-- (it writes its own integration_events row directly) so it needs its own
-- explicit enqueue call for the price-alert check. That function's raw
-- insert not reaching the search_index queue at all is a pre-existing gap
-- (search_index queue is not touched here), independent of this migration.

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
  end if;

  return v_event_id;
end;
$$;

revoke execute on function emit_integration_event(uuid, text, text, uuid, jsonb) from public, anon, authenticated;

-- Reproduced verbatim from 20260726000000_require_pricing_permissions_on_publish_and_override.sql
-- (the current definition -- CREATE OR REPLACE cannot rename the existing
-- parameter, and every other line, including the pre-existing raw
-- integration_events insert, is unchanged) with exactly one addition: the
-- restock_alerts enqueue for the price-alert check, mirroring the pattern
-- above.
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

  insert into integration_events (organisation_id, aggregate_id, aggregate_type, event_type, payload)
    values (
      v_published.organisation_id,
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

  perform pgmq.send('restock_alerts', jsonb_build_object(
    'checkType', 'price',
    'sellableSkuId', v_published.sellable_sku_id,
    'finalAmount', v_published.final_amount,
    'currency', v_published.currency
  ));

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
