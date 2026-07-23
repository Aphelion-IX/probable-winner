-- RECONCILIATION NOTE: pulled verbatim from the live project's migration
-- history (see 20260723064823_fix_transfer_status_transitions.sql for why).
-- This live fix corrected the reservation-table name only; it left in
-- place the same cl.reservation_id / cl.price_at_add / published_prices
-- issues as the original -- price_at_add isn't a real cart_lines column
-- either. Left as originally applied here (matching live); addressed in
-- 20260724160000_fix_checkout_payment_confirmation.sql.

-- Fix validate_checkout to use correct inventory_reservations table name
create or replace function validate_checkout(
  cart_id uuid,
  customer_id uuid
) returns json as $$
declare
  v_cart record;
  v_total_amount numeric;
  v_currency text;
  v_errors jsonb := '[]'::jsonb;
begin
  select * into v_cart from carts where id = cart_id;
  if v_cart is null then
    v_errors := v_errors || jsonb_build_array('cart_not_found');
    return jsonb_build_object('valid', false, 'errors', v_errors);
  end if;

  -- Check: all cart reservations still active (not expired)
  if exists (
    select 1 from cart_lines cl
    left join inventory_reservations r on r.id = cl.reservation_id
    where cl.cart_id = cart_id
      and (r.id is null or r.status != 'active')
  ) then
    v_errors := v_errors || jsonb_build_array('reservation_expired_or_invalid');
  end if;

  -- Check: prices haven't changed unexpectedly (within tolerances)
  -- Note: exact price validation happens in checkout handler; this is a soft check
  if exists (
    select 1 from cart_lines cl
    join sellable_skus sk on sk.id = cl.sellable_sku_id
    where cl.cart_id = cart_id
      and cl.price_at_add > (
        select final_amount from published_prices pp
        where pp.sellable_sku_id = cl.sellable_sku_id
          and pp.organisation_id = v_cart.organisation_id
        limit 1
      ) * 1.1  -- 10% price increase tolerance
  ) then
    v_errors := v_errors || jsonb_build_array('price_increased_significantly');
  end if;

  -- Check: at least one line in cart
  if not exists (select 1 from cart_lines where cart_id = cart_id) then
    v_errors := v_errors || jsonb_build_array('cart_empty');
  end if;

  return jsonb_build_object(
    'valid', jsonb_array_length(v_errors) = 0,
    'errors', v_errors
  );
end;
$$ language plpgsql security definer;
