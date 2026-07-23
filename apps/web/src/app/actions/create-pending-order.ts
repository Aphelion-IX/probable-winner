'use server';

import { createClient } from '@supabase/supabase-js';

interface CheckoutValidationError {
  field: string;
  message: string;
}

interface CreatePendingOrderResult {
  success: boolean;
  orderId?: string;
  errors?: CheckoutValidationError[];
}

export async function createPendingOrder(
  cartId: string,
  fulfillmentType: 'delivery' | 'collect',
  address?: {
    line1: string;
    line2?: string;
    suburb: string;
    state: string;
    postcode: string;
  },
  storeId?: string
): Promise<CreatePendingOrderResult> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const errors: CheckoutValidationError[] = [];

  // Validate fulfillment type
  if (!fulfillmentType || !['delivery', 'collect'].includes(fulfillmentType)) {
    errors.push({
      field: 'fulfillmentType',
      message: 'Invalid fulfillment type',
    });
  }

  // Validate address for delivery
  if (fulfillmentType === 'delivery') {
    if (!address?.line1?.trim()) {
      errors.push({
        field: 'address.line1',
        message: 'Street address is required for delivery',
      });
    }
    if (!address?.suburb?.trim()) {
      errors.push({
        field: 'address.suburb',
        message: 'Suburb/city is required for delivery',
      });
    }
    if (!address?.postcode?.trim()) {
      errors.push({
        field: 'address.postcode',
        message: 'Postcode is required for delivery',
      });
    } else if (!/^\d{4}$/.test(address.postcode)) {
      errors.push({
        field: 'address.postcode',
        message: 'Postcode must be 4 digits',
      });
    }
  }

  // Validate store for click-and-collect
  if (fulfillmentType === 'collect' && !storeId?.trim()) {
    errors.push({
      field: 'storeId',
      message: 'Store selection is required for click and collect',
    });
  }

  // Validate cart exists and has items
  const { data: cart, error: cartError } = await supabase
    .from('carts')
    .select('id, cart_lines(count)')
    .eq('id', cartId)
    .single();

  if (cartError || !cart) {
    errors.push({
      field: 'cart',
      message: 'Cart not found',
    });
  }

  if (cart && (!cart.cart_lines || cart.cart_lines.length === 0)) {
    errors.push({
      field: 'cart',
      message: 'Cart is empty',
    });
  }

  // Validate cart contents (revalidate reservations and prices)
  if (cart?.id) {
    const { data: cartLines, error: linesError } = await supabase
      .from('cart_lines')
      .select(`
        id,
        sellable_sku_id,
        quantity,
        price_at_add,
        reservation_id,
        reservations!cart_lines_reservation_id_fkey(
          id,
          expires_at
        ),
        published_prices(final_amount)
      `)
      .eq('cart_id', cartId);

    if (linesError) {
      errors.push({
        field: 'cart',
        message: 'Failed to validate cart contents',
      });
    } else if (cartLines) {
      // Check for expired reservations
      const now = new Date();
      for (const line of cartLines) {
        const reservation = Array.isArray(line.reservations)
          ? line.reservations[0]
          : line.reservations;

        if (
          !reservation ||
          (reservation.expires_at && new Date(reservation.expires_at) < now)
        ) {
          errors.push({
            field: `cartLine_${line.id}`,
            message: 'Item reservation has expired. Please add it to cart again.',
          });
        }
      }

      // Check for price changes (tolerance: ±10%)
      for (const line of cartLines) {
        const prices = Array.isArray(line.published_prices)
          ? line.published_prices
          : [line.published_prices];
        const currentPrice = prices?.[0]?.final_amount;

        if (currentPrice !== undefined && currentPrice !== null) {
          const priceDifference = Math.abs(currentPrice - line.price_at_add);
          const percentChange = (priceDifference / line.price_at_add) * 100;

          if (percentChange > 10) {
            errors.push({
              field: `cartLine_${line.id}_price`,
              message: `Price changed by ${percentChange.toFixed(1)}%. Please review and reconfirm.`,
            });
          }
        }
      }
    }
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  // Create pending order
  try {
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        cart_id: cartId,
        status: 'pending',
        fulfillment_type: fulfillmentType,
        delivery_address: fulfillmentType === 'delivery' ? address : null,
        fulfillment_node_id: fulfillmentType === 'collect' ? storeId : null,
      })
      .select('id')
      .single();

    if (orderError || !order) {
      return {
        success: false,
        errors: [
          {
            field: 'order',
            message: 'Failed to create order. Please try again.',
          },
        ],
      };
    }

    return { success: true, orderId: order.id };
  } catch (error) {
    return {
      success: false,
      errors: [
        {
          field: 'order',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      ],
    };
  }
}
