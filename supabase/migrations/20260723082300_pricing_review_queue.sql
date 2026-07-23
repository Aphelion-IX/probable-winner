-- Review queue and manual price approval/override (backlog B-163).
-- Staff with pricing.approve can approve suggested prices.
-- Staff with pricing.override can override with custom prices.
-- Both paths emit integration events for audit and downstream triggers (B-165 reindex).

-- Helper: does the current user have a specific permission?
-- Checks the role_permissions join via the current user's staff membership roles.
create or replace function staff_has_permission(required_permission text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from staff_memberships m
    join role_permissions rp on rp.role_code = m.role_code
    where m.user_id = auth.uid()
      and m.active
      and rp.permission_code = required_permission
  );
$$;

-- Add metadata column to store override tracking and audit info.
alter table calculated_prices add column metadata jsonb;

-- Allow update on calculated_prices only for pricing approval/override.
-- SECURITY DEFINER functions below are the only writers, not direct UPDATEs via Data API.
create policy calculated_prices_update on calculated_prices
  for update to authenticated
  using (staff_has_permission('pricing.approve') or staff_has_permission('pricing.override'))
  with check (staff_has_permission('pricing.approve') or staff_has_permission('pricing.override'));

-- Approve a suggested price, transitioning status from 'suggested' to 'approved'.
-- Emits a pricing_approved event for downstream triggers (B-165 reindex, audit logging).
create or replace function approve_suggested_price(
  calculated_price_id uuid
) returns json as $$
declare
  v_price record;
  v_event record;
begin
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

  update calculated_prices
    set status = 'approved', updated_at = now()
    where id = calculated_price_id;

  -- Emit integration event for audit and reindex (B-165).
  insert into integration_events (aggregate_id, aggregate_type, event_type, event_data)
    values (
      calculated_price_id,
      'calculated_price',
      'pricing_approved',
      jsonb_build_object(
        'calculated_price_id', calculated_price_id,
        'final_amount', v_price.final_amount,
        'currency', v_price.currency,
        'approved_by', auth.uid(),
        'approved_at', now()
      )
    );

  return jsonb_build_object(
    'id', v_price.id,
    'status', 'approved'
  );
end;
$$ language plpgsql security definer;

-- Override a suggested price with a custom final amount.
-- Transitions status from 'suggested' to 'approved' with the custom amount.
-- Emits a pricing_overridden event for audit and downstream use.
create or replace function override_suggested_price(
  calculated_price_id uuid,
  override_amount numeric
) returns json as $$
declare
  v_price record;
  v_event record;
begin
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

  -- Store the original calculated final_amount in a jsonb metadata field
  -- so the audit trail shows what was calculated vs. what was overridden.
  update calculated_prices
    set
      final_amount = override_amount,
      status = 'approved',
      updated_at = now(),
      -- Track override in metadata for full auditability.
      metadata = jsonb_build_object(
        'original_final_amount', v_price.final_amount,
        'override_amount', override_amount,
        'override_reason', 'manual_staff_override'
      )
    where id = calculated_price_id;

  insert into integration_events (aggregate_id, aggregate_type, event_type, event_data)
    values (
      calculated_price_id,
      'calculated_price',
      'pricing_overridden',
      jsonb_build_object(
        'calculated_price_id', calculated_price_id,
        'original_final_amount', v_price.final_amount,
        'override_amount', override_amount,
        'currency', v_price.currency,
        'overridden_by', auth.uid(),
        'overridden_at', now()
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

-- Reject a suggested price after review (does not publish).
-- Emits a pricing_rejected event for audit.
create or replace function reject_suggested_price(
  calculated_price_id uuid
) returns json as $$
declare
  v_price record;
begin
  select * into v_price from calculated_prices where id = calculated_price_id for update;
  if v_price is null then
    raise exception 'calculated_price not found: %', calculated_price_id;
  end if;

  if v_price.status = 'approved' then
    raise exception 'cannot reject an approved price: %', calculated_price_id;
  end if;

  update calculated_prices
    set status = 'rejected', updated_at = now()
    where id = calculated_price_id;

  insert into integration_events (aggregate_id, aggregate_type, event_type, event_data)
    values (
      calculated_price_id,
      'calculated_price',
      'pricing_rejected',
      jsonb_build_object(
        'calculated_price_id', calculated_price_id,
        'rejected_by', auth.uid(),
        'rejected_at', now()
      )
    );

  return jsonb_build_object(
    'id', v_price.id,
    'status', 'rejected'
  );
end;
$$ language plpgsql security definer;
