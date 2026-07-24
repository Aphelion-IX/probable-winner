-- Fix two bugs found while building the staff pricing review UI (B-163):
--
-- 1. approve_suggested_price()/override_suggested_price()/reject_suggested_price()
--    (20260723082300_pricing_review_queue.sql) never check
--    staff_has_permission() at all. They're SECURITY DEFINER, so the
--    calculated_prices_update RLS policy (which does check
--    staff_has_permission('pricing.approve'/'pricing.override')) never
--    applies to their internal UPDATEs -- RLS is not enforced against a
--    security-definer function's owner. With no EXECUTE grant restriction
--    either, any authenticated user (staff or not) could approve/override/
--    reject any price, contradicting B-163's AC ("staff with
--    pricing.approve/pricing.override permission can review/override").
--
-- 2. Same broken integration_events insert this session already found and
--    fixed in publish_suggested_price()/set_price_override()/
--    clear_price_override() (20260724190000_fix_pricing_integration_events.sql):
--    these three functions insert directly using a nonexistent event_data
--    column instead of payload, and skip the required organisation_id --
--    every call has been throwing at that insert since the table was
--    created. Route through emit_integration_event() like every other
--    atomic function already does.

create or replace function approve_suggested_price(
  calculated_price_id uuid
) returns json as $$
declare
  v_price record;
  v_org_id uuid;
begin
  if not staff_has_permission('pricing.approve') then
    raise exception 'approve_suggested_price: pricing.approve permission required'
      using errcode = '42501';
  end if;

  select * into v_price from calculated_prices where id = calculated_price_id for update;
  if v_price is null then
    raise exception 'calculated_price not found: %', calculated_price_id;
  end if;

  if v_price.status = 'approved' then
    raise exception 'price already approved: %', calculated_price_id;
  end if;

  if v_price.status = 'rejected' then
    raise exception 'cannot approve a rejected price: %', calculated_price_id;
  end if;

  select organisation_id into v_org_id from pricing_rules where id = v_price.pricing_rule_id;

  update calculated_prices
    set status = 'approved', updated_at = now()
    where id = calculated_price_id;

  perform emit_integration_event(
    v_org_id,
    'pricing_approved',
    'calculated_price',
    calculated_price_id,
    jsonb_build_object(
      'calculatedPriceId', calculated_price_id,
      'finalAmount', v_price.final_amount,
      'currency', v_price.currency,
      'approvedBy', auth.uid(),
      'approvedAt', now()
    )
  );

  return jsonb_build_object(
    'id', v_price.id,
    'status', 'approved'
  );
end;
$$ language plpgsql security definer;

create or replace function override_suggested_price(
  calculated_price_id uuid,
  override_amount numeric
) returns json as $$
declare
  v_price record;
  v_org_id uuid;
begin
  if not staff_has_permission('pricing.override') then
    raise exception 'override_suggested_price: pricing.override permission required'
      using errcode = '42501';
  end if;

  if override_amount < 0 then
    raise exception 'override amount cannot be negative: %', override_amount;
  end if;

  select * into v_price from calculated_prices where id = calculated_price_id for update;
  if v_price is null then
    raise exception 'calculated_price not found: %', calculated_price_id;
  end if;

  if v_price.status = 'rejected' then
    raise exception 'cannot override a rejected price: %', calculated_price_id;
  end if;

  select organisation_id into v_org_id from pricing_rules where id = v_price.pricing_rule_id;

  -- Store the original calculated final_amount in a jsonb metadata field
  -- so the audit trail shows what was calculated vs. what was overridden.
  update calculated_prices
    set
      final_amount = override_amount,
      status = 'approved',
      updated_at = now(),
      metadata = jsonb_build_object(
        'original_final_amount', v_price.final_amount,
        'override_amount', override_amount,
        'override_reason', 'manual_staff_override'
      )
    where id = calculated_price_id;

  perform emit_integration_event(
    v_org_id,
    'pricing_overridden',
    'calculated_price',
    calculated_price_id,
    jsonb_build_object(
      'calculatedPriceId', calculated_price_id,
      'originalFinalAmount', v_price.final_amount,
      'overrideAmount', override_amount,
      'currency', v_price.currency,
      'overriddenBy', auth.uid(),
      'overriddenAt', now()
    )
  );

  return jsonb_build_object(
    'id', v_price.id,
    'original_final_amount', v_price.final_amount,
    'override_amount', override_amount,
    'status', 'approved'
  );
end;
$$ language plpgsql security definer;

create or replace function reject_suggested_price(
  calculated_price_id uuid
) returns json as $$
declare
  v_price record;
  v_org_id uuid;
begin
  if not (staff_has_permission('pricing.approve') or staff_has_permission('pricing.override')) then
    raise exception 'reject_suggested_price: pricing.approve or pricing.override permission required'
      using errcode = '42501';
  end if;

  select * into v_price from calculated_prices where id = calculated_price_id for update;
  if v_price is null then
    raise exception 'calculated_price not found: %', calculated_price_id;
  end if;

  if v_price.status = 'approved' then
    raise exception 'cannot reject an approved price: %', calculated_price_id;
  end if;

  select organisation_id into v_org_id from pricing_rules where id = v_price.pricing_rule_id;

  update calculated_prices
    set status = 'rejected', updated_at = now()
    where id = calculated_price_id;

  perform emit_integration_event(
    v_org_id,
    'pricing_rejected',
    'calculated_price',
    calculated_price_id,
    jsonb_build_object(
      'calculatedPriceId', calculated_price_id,
      'rejectedBy', auth.uid(),
      'rejectedAt', now()
    )
  );

  return jsonb_build_object(
    'id', v_price.id,
    'status', 'rejected'
  );
end;
$$ language plpgsql security definer;
