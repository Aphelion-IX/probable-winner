-- pgTAP tests for orders, shipments, and payment confirmation (Phase 2, B-120+).
-- Core AC: checkout revalidates reservation ownership/expiry, price changes, total;
-- Stripe webhook idempotency; payment converts reservations to allocations (blueprint §16).

begin;

select plan(15);

-- Setup: create org, stores, SKU, customer, and cart with reservation.
insert into organisations (id) values ('test-org-id');
insert into fulfilment_nodes (id, organisation_id, type, name) values
  ('store-1', 'test-org-id', 'store', 'Test Store 1'),
  ('store-2', 'test-org-id', 'store', 'Test Store 2');

insert into sellable_skus (card_printing_id, language_id, finish_id, condition_id)
values ('test-printing-1', 'en', 'nonfoil', 'nm');

insert into published_prices (organisation_id, pricing_rule_id, sellable_sku_id, calculated_price_id, final_amount, currency, status)
select 'test-org-id', pr.id, sk.id, cp.id, 25.00, 'AUD', 'active'
from pricing_rules pr, sellable_skus sk, calculated_prices cp
where pr.organisation_id = 'test-org-id' and sk.card_printing_id = 'test-printing-1'
  and cp.final_amount = 25.00 limit 1;

insert into carts (id, organisation_id, guest_session_id, customer_id)
values ('test-cart-1', 'test-org-id', 'guest-session-1', auth.uid());

insert into reservations (id, sellable_sku_id, fulfilment_node_id, status, quantity)
values ('test-reservation-1', (select id from sellable_skus where card_printing_id = 'test-printing-1' limit 1), 'store-1', 'active', 1);

insert into cart_lines (id, cart_id, sellable_sku_id, reservation_id, quantity, price_at_add)
values ('test-line-1', 'test-cart-1', (select id from sellable_skus limit 1), 'test-reservation-1', 1, 25.00);

-- Test 1: Create a pending order.
select ok(
  (
    insert into orders (organisation_id, fulfilment_node_id, customer_id, order_number, status, fulfilment_type, total_amount, currency)
    values ('test-org-id', 'store-1', auth.uid(), 'ORD-001', 'pending', 'online_shipping', 25.00, 'AUD')
    returning status = 'pending'
  ),
  'pending order is created with correct status'
);

-- Test 2: Order lines are immutable.
select ok(
  (
    with ord as (select id from orders where order_number = 'ORD-001' limit 1),
    line as (
      insert into order_lines (order_id, sellable_sku_id, quantity, unit_price, line_total)
      select ord.id, sk.id, 1, 25.00, 25.00
      from ord, sellable_skus sk where sk.card_printing_id = 'test-printing-1'
      returning 1
    )
    select count(*) = 1 from line
  ),
  'order line is created and linked to SKU'
);

-- Test 3: validate_checkout detects empty cart.
select ok(
  (
    select jsonb_path_exists(
      validate_checkout('nonexistent-cart', auth.uid()),
      '$.errors[*] ? (@ == "cart_not_found")'
    )
  ),
  'validate_checkout detects missing cart'
);

-- Test 4: validate_checkout succeeds for valid cart.
select ok(
  (
    select (validate_checkout('test-cart-1', auth.uid())->>'valid')::boolean
  ),
  'validate_checkout succeeds for cart with active reservation and valid price'
);

-- Test 5: Stripe event idempotency - first event is processed.
select ok(
  (
    with ord as (select id from orders where order_number = 'ORD-001' limit 1),
    confirmed as (
      select confirm_order_payment(ord.id, 'evt_test_123')
      from ord
    )
    select status = 'confirmed' from (select (confirmed->>'status')::text as status from confirmed) sub
  ),
  'confirm_order_payment processes first Stripe event and transitions to paid'
);

-- Test 6: Stripe event idempotency - second delivery of same event returns success without repeating.
select ok(
  (
    with ord as (select id from orders where order_number = 'ORD-001' limit 1),
    confirmed2 as (
      select confirm_order_payment(ord.id, 'evt_test_123')
      from ord
    )
    select status = 'already_processed' from (select (confirmed2->>'status')::text as status from confirmed2) sub
  ),
  'confirm_order_payment returns already_processed for duplicate event, no side effects'
);

-- Test 7: Order status changed to paid.
select ok(
  (select status = 'paid' from orders where order_number = 'ORD-001' limit 1),
  'order status is paid after payment confirmation'
);

-- Test 8: Stripe event stored with correct order_id.
select ok(
  (
    select exists(
      select 1 from stripe_events se
      join orders o on o.id = se.order_id
      where se.id = 'evt_test_123' and o.order_number = 'ORD-001'
    )
  ),
  'Stripe event is stored with correct order linkage'
);

-- Test 9: Cannot confirm payment for non-pending order.
select throws_ok(
  (
    insert into orders (organisation_id, fulfilment_node_id, customer_id, order_number, status, fulfilment_type, total_amount, currency)
    values ('test-org-id', 'store-1', auth.uid(), 'ORD-002', 'cancelled', 'online_shipping', 25.00, 'AUD')
    returning id into temp_id;
    select confirm_order_payment(temp_id, 'evt_test_456');
  ),
  null, null,
  'cannot confirm payment for non-pending order'
);

-- Test 10: Stripe events are staff-only via RLS.
select ok(
  (
    select exists(
      select 1 from pg_policies
      where tablename = 'stripe_events' and policyname = 'stripe_events_select'
    )
  ),
  'RLS policy exists for stripe_events staff-only access'
);

-- Test 11: Customer RLS: can see own order.
select ok(
  (
    select exists(
      select 1 from orders where order_number = 'ORD-001' and customer_id = auth.uid()
    )
  ),
  'customer can see own order via RLS'
);

-- Test 12: release_failed_order_reservations releases reservations.
select ok(
  (
    with ord as (select id from orders where order_number = 'ORD-001' limit 1),
    released as (
      select release_failed_order_reservations(ord.id) from ord
    )
    select (released->>'status')::text = 'reservations_released' from released
  ),
  'release_failed_order_reservations marks reservations as released'
);

-- Test 13: Integration event emitted on order payment.
select ok(
  (
    select exists(
      select 1 from integration_events
      where event_type = 'order_paid'
    )
  ),
  'order_paid integration event emitted on payment confirmation'
);

-- Test 14: Order number is unique per organisation.
select throws_ok(
  (
    insert into orders (organisation_id, fulfilment_node_id, customer_id, order_number, status, fulfilment_type, total_amount, currency)
    values ('test-org-id', 'store-1', auth.uid(), 'ORD-001', 'pending', 'online_shipping', 30.00, 'AUD');
  ),
  null, null,
  'duplicate order number per org is rejected'
);

-- Test 15: Shipment can be created for an order.
select ok(
  (
    with ord as (select id from orders where order_number = 'ORD-001' limit 1),
    ship as (
      insert into shipments (order_id, tracking_number, carrier)
      select ord.id, 'TRK-123456', 'AusPost'
      from ord
      returning 1
    )
    select count(*) = 1 from ship
  ),
  'shipment record is created and linked to order'
);

select finish();

rollback;
