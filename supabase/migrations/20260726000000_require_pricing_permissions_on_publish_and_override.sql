-- Adds the missing permission checks to the three pricing mutation functions
-- that had none, and removes anon's EXECUTE grant on the whole pricing
-- mutation family.
--
-- THE BUG
--
-- 20260723231906_published_prices_and_overrides.sql shipped six pricing
-- mutation functions. Three of them check a permission before doing anything:
--
--   approve_suggested_price   -> pricing.approve
--   reject_suggested_price    -> pricing.approve or pricing.override
--   override_suggested_price  -> pricing.override
--
-- The other three check nothing at all:
--
--   publish_suggested_price
--   set_price_override
--   clear_price_override
--
-- All six are SECURITY DEFINER with EXECUTE granted to `anon`, so the three
-- unguarded ones were callable by an unauthenticated request to
-- /rest/v1/rpc/<name>. Verified against the live database from the `anon`
-- role (both in rolled-back transactions):
--
--   * set_price_override(<published_price>, <node>, 0.01, '...') succeeded,
--     repricing a $66.10 card to $0.01 for that fulfilment node.
--   * publish_suggested_price(<approved calculated_price>) succeeded,
--     writing to published_prices -- the table the storefront reads.
--
-- publish_suggested_price is the more serious of the two today: published_prices
-- carries a public SELECT policy for status = 'active', so anything published
-- there is live storefront data immediately. published_price_overrides is
-- currently staff-read-only via RLS and has no application read path yet
-- (only tests reference it), so the override functions are a data-integrity
-- problem now and a live pricing hole the moment that read path lands.
--
-- This is the same failure mode as 20260725210000: a SECURITY DEFINER function
-- exposed to anon that re-implements (or here, simply omits) the authorisation
-- its callers assumed was there. It is also what AGENTS.md rule 9 -- "do not
-- publish prices without anomaly checks" -- is guarding against, from the
-- other direction: anomaly checks are worthless if an anonymous caller can
-- publish directly.
--
-- WHY IT SURVIVED REVIEW
--
-- The three guarded functions and the three unguarded ones were added in the
-- same migration, and the guarded ones read as the house style, so the family
-- looks uniformly protected at a glance. The gap only shows up by reading all
-- six bodies side by side. The pricing review screen calls only the three
-- guarded ones (manage-pricing-review.ts), so no application code path ever
-- exercised the unguarded three and no test covered them.
--
-- THE FIX
--
-- Each unguarded function gets the same guard shape its siblings already use:
-- a staff_has_permission() check that raises 42501 before any state changes.
--
--   publish_suggested_price -> pricing.approve
--   set_price_override      -> pricing.override
--   clear_price_override    -> pricing.override
--
-- pricing.approve for publishing rather than a new pricing.publish code:
-- only pricing.view/approve/override exist, and introducing a fourth would
-- need its own seeding pass across every role to avoid locking publishing out
-- entirely. Publishing is the continuation of approving, and pricing.approve
-- is already held by exactly the roles that should be able to do it (owner,
-- system_admin, regional_manager, pricing_manager). Split it into a dedicated
-- pricing.publish later if the two ever need to diverge.
--
-- pricing.override for both override functions matches override_suggested_price,
-- which already gates the equivalent operation one table upstream.
--
-- Deliberately NOT adding the is_trusted_backend_connection() bypass:
-- 20260723063506 says to apply that "only if/when a worker job actually needs
-- to call them directly, rather than adding it everywhere speculatively", and
-- no worker calls any of these three. The guarded siblings do not carry it
-- either.
--
-- Bodies are otherwise reproduced verbatim -- SECURITY DEFINER, search_path,
-- volatility and return type are unchanged, and CREATE OR REPLACE cannot
-- rename the existing parameters.

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

-- p_reason keeps its `default null` -- CREATE OR REPLACE refuses to drop an
-- existing parameter default ("cannot remove parameter defaults from existing
-- function"), and dropping it would silently break any three-argument caller.
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

  insert into integration_events (organisation_id, aggregate_id, aggregate_type, event_type, payload)
    values (
      v_published.organisation_id,
      p_published_price_id,
      'published_price',
      'pricing_override_set',
      jsonb_build_object(
        'published_price_id', p_published_price_id,
        'fulfilment_node_id', p_fulfilment_node_id,
        'override_amount', p_override_amount,
        'reason', p_reason,
        'set_at', now()
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

  insert into integration_events (organisation_id, aggregate_id, aggregate_type, event_type, payload)
    values (
      v_published.organisation_id,
      p_published_price_id,
      'published_price',
      'pricing_override_cleared',
      jsonb_build_object(
        'published_price_id', p_published_price_id,
        'fulfilment_node_id', p_fulfilment_node_id,
        'cleared_at', now()
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

-- Defence in depth, and it clears the corresponding
-- anon_security_definer_function_executable advisor lints. The permission
-- checks above are the actual fix -- anon can never satisfy
-- staff_has_permission(), which resolves staff_memberships by auth.uid() --
-- but there is no legitimate anonymous caller for any of these six, so the
-- grant should not be there either. `authenticated` keeps EXECUTE: the
-- pricing review screen calls approve/override/reject with the staff user's
-- own session, and the permission check inside each function is what
-- distinguishes a pricing manager from any other signed-in user.
-- Revoked from `public` as well as `anon`, and `authenticated` re-granted
-- explicitly. These functions were created with the default PUBLIC EXECUTE
-- grant still in place (visible as `=X/postgres` in proacl), so revoking from
-- `anon` alone changes nothing -- anon inherits EXECUTE from PUBLIC and can
-- still reach the function. Confirmed the hard way: after an anon-only
-- revoke, an `anon` call still entered the function body and was stopped by
-- the permission check above rather than by the grant. Same shape as the
-- revokes in 20260725210000, which target `public, anon, authenticated`.
revoke execute on function publish_suggested_price(uuid) from public, anon;
revoke execute on function approve_suggested_price(uuid) from public, anon;
revoke execute on function reject_suggested_price(uuid) from public, anon;
revoke execute on function override_suggested_price(uuid, numeric) from public, anon;
revoke execute on function set_price_override(uuid, uuid, numeric, text) from public, anon;
revoke execute on function clear_price_override(uuid, uuid) from public, anon;

grant execute on function publish_suggested_price(uuid) to authenticated;
grant execute on function approve_suggested_price(uuid) to authenticated;
grant execute on function reject_suggested_price(uuid) to authenticated;
grant execute on function override_suggested_price(uuid, numeric) to authenticated;
grant execute on function set_price_override(uuid, uuid, numeric, text) to authenticated;
grant execute on function clear_price_override(uuid, uuid) to authenticated;
