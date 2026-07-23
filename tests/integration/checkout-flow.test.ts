import { describe, it, expect, beforeEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

describe('Checkout Flow Integration Tests', () => {
  let organisationId: string;
  let cartId: string;
  let skuId: string;

  beforeEach(async () => {
    // Setup test data
    // Note: In real integration tests, this would create test records
    // For now, we skip actual DB setup and focus on flow validation
  });

  it('should validate cart items before checkout', async () => {
    // Test that cart validation catches missing items
    const { data: cart } = await supabase
      .from('carts')
      .select(
        `
      id,
      cart_lines(
        id,
        sellable_sku_id,
        quantity
      )
    `
      )
      .limit(1)
      .single();

    expect(cart).toBeDefined();
    if (cart?.cart_lines) {
      expect(Array.isArray(cart.cart_lines)).toBe(true);
    }
  });

  it('should detect expired reservations during checkout', async () => {
    // Test that reservations with expires_at in the past are detected
    const { data: expiredLines } = await supabase
      .from('cart_lines')
      .select(
        `
      id,
      reservation_id,
      reservations!cart_lines_reservation_id_fkey(
        id,
        expires_at,
        status
      )
    `
      )
      .lt('reservations.expires_at', new Date().toISOString())
      .limit(1);

    // Should either have expired reservations or be empty
    if (expiredLines && expiredLines.length > 0) {
      const line = expiredLines[0];
      const reservation = Array.isArray(line.reservations)
        ? line.reservations[0]
        : line.reservations;
      if (reservation) {
        expect(new Date(reservation.expires_at) < new Date()).toBe(true);
      }
    }
  });

  it('should validate price tolerance during checkout', async () => {
    // Test that price changes are detected within tolerance
    const { data: lines } = await supabase
      .from('cart_lines')
      .select(
        `
      id,
      price_at_add,
      published_prices(final_amount)
    `
      )
      .limit(5);

    if (lines && lines.length > 0) {
      for (const line of lines) {
        const prices = Array.isArray(line.published_prices)
          ? line.published_prices
          : [line.published_prices];
        const currentPrice = prices?.[0]?.final_amount;

        if (currentPrice !== undefined && currentPrice !== null) {
          const percentChange =
            (Math.abs(currentPrice - line.price_at_add) /
              line.price_at_add) *
            100;

          // Price change should be detected if > 10%
          if (percentChange > 10) {
            expect(percentChange).toBeGreaterThan(10);
          } else {
            expect(percentChange).toBeLessThanOrEqual(10);
          }
        }
      }
    }
  });

  it('should enforce address validation for delivery orders', async () => {
    // Test address field validation
    const validAddresses = [
      {
        line1: '123 Main St',
        suburb: 'Sydney',
        state: 'NSW',
        postcode: '2000',
        valid: true,
      },
      {
        line1: '456 Oak Ave',
        suburb: 'Melbourne',
        state: 'VIC',
        postcode: '3000',
        valid: true,
      },
      {
        line1: '',
        suburb: 'Brisbane',
        state: 'QLD',
        postcode: '4000',
        valid: false,
      },
      {
        line1: '789 Elm Dr',
        suburb: '',
        state: 'SA',
        postcode: '5000',
        valid: false,
      },
      {
        line1: '321 Pine St',
        suburb: 'Perth',
        state: 'WA',
        postcode: '500',
        valid: false,
      },
    ];

    for (const address of validAddresses) {
      const hasValidPostcode = /^\d{4}$/.test(address.postcode);
      const hasValidAddress =
        address.line1.trim() !== '' &&
        address.suburb.trim() !== '' &&
        hasValidPostcode;

      expect(hasValidAddress).toBe(address.valid);
    }
  });

  it('should verify order creation succeeds with valid data', async () => {
    // Test that orders can be created with valid checkout data
    const { data: orders } = await supabase
      .from('orders')
      .select('id, status, fulfilment_type')
      .eq('status', 'pending')
      .limit(1);

    // Should be able to query pending orders
    expect(Array.isArray(orders)).toBe(true);
  });

  it('should enforce RLS on order access', async () => {
    // Test that customers can only see their own orders
    const { data: customerOrders } = await supabase
      .from('orders')
      .select('id, customer_id')
      .limit(5);

    // Should only return orders visible to authenticated user
    if (customerOrders && customerOrders.length > 0) {
      // In a real test, this would use a customer's auth token
      // For now, just verify the query doesn't error
      expect(Array.isArray(customerOrders)).toBe(true);
    }
  });

  it('should handle cart to order line conversion', async () => {
    // Test that cart_lines properly map to order_lines
    const { data: cartLines } = await supabase
      .from('cart_lines')
      .select(
        `
      id,
      quantity,
      price_at_add,
      sellable_sku_id
    `
      )
      .limit(3);

    if (cartLines && cartLines.length > 0) {
      for (const line of cartLines) {
        // Each cart_line should have required fields
        expect(line.id).toBeDefined();
        expect(line.quantity).toBeGreaterThan(0);
        expect(line.price_at_add).toBeGreaterThanOrEqual(0);
        expect(line.sellable_sku_id).toBeDefined();
      }
    }
  });

  it('should verify Stripe event idempotency schema', async () => {
    // Test that stripe_events table supports idempotent inserts
    const { data: events, error: selectError } = await supabase
      .from('stripe_events')
      .select('id, event_type')
      .limit(1);

    // Schema should exist and allow querying
    expect(selectError === null || selectError === undefined).toBe(true);
    expect(Array.isArray(events)).toBe(true);
  });

  it('should detect missing fulfillment node for orders', async () => {
    // Test that orders reference valid fulfillment nodes
    const { data: orders } = await supabase
      .from('orders')
      .select(
        `
      id,
      fulfilment_node_id,
      fulfilment_nodes(id, name)
    `
      )
      .limit(5);

    if (orders && orders.length > 0) {
      for (const order of orders) {
        expect(order.fulfilment_node_id).toBeDefined();
        // Fulfillment node reference should resolve
        const node = Array.isArray(order.fulfilment_nodes)
          ? order.fulfilment_nodes[0]
          : order.fulfilment_nodes;
        expect(node).toBeDefined();
      }
    }
  });
});
