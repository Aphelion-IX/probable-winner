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

interface CartData {
  id: string;
  organisation_id: string;
  cart_lines: Array<{
    id: string;
    sellable_sku_id: string;
    quantity: number;
    price_at_add: number;
    reservation_id: string;
    reservations: { id: string; expires_at: string } | null;
    published_prices: { final_amount: number } | null;
  }>;
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

  if (!fulfillmentType || !['delivery', 'collect'].includes(fulfillmentType)) {
    errors.push({
      field: 'fulfillmentType',
      message: 'Invalid fulfillment type',
    });
  }

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

  if (fulfillmentType === 'collect' && !storeId?.trim()) {
    errors.push({
      field: 'storeId',
      message: 'Store selection is required for click and collect',
    });
  }

  // Fetch cart with organisation and items
  const { data: cart, error: cartError } = await supabase
    .from('carts')
    .select(
      `
      id,
      organisation_id,
      cart_lines(
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
      )
    `
    )
    .eq('id', cartId)
    .single();

  if (cartError || !cart) {
    errors.push({
      field: 'cart',
      message: 'Cart not found',
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cartData = cart as any as CartData;

  if (
    cartData &&
    (!cartData.cart_lines || cartData.cart_lines.length === 0)
  ) {
    errors.push({
      field: 'cart',
      message: 'Cart is empty',
    });
  }

  // Validate cart contents
  if (cartData?.id) {
    const now = new Date();
    for (const line of cartData.cart_lines) {
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

  if (errors.length > 0) {
    return { success: false, errors };
  }

  try {
    // Get the default fulfilment node for the organisation
    const { data: defaultNode } = await supabase
      .from('fulfilment_nodes')
      .select('id')
      .eq('organisation_id', cartData.organisation_id)
      .limit(1)
      .single();

    if (!defaultNode) {
      return {
        success: false,
        errors: [
          {
            field: 'organisation',
            message: 'No fulfilment node found for organisation',
          },
        ],
      };
    }

    let shippingAddressId: string | null = null;
    let collectionStoreId: string | null = null;

    // Create address record if delivery
    if (fulfillmentType === 'delivery' && address) {
      const { data: newAddress, error: addressError } = await supabase
        .from('addresses')
        .insert({
          organisation_id: cartData.organisation_id,
          line1: address.line1,
          line2: address.line2 || null,
          suburb: address.suburb,
          state: address.state,
          postcode: address.postcode,
          country: 'AU',
        })
        .select('id')
        .single();

      if (addressError || !newAddress) {
        return {
          success: false,
          errors: [
            {
              field: 'address',
              message: 'Failed to save address',
            },
          ],
        };
      }

      shippingAddressId = newAddress.id;
    }

    // Map fulfilment node for collection
    if (fulfillmentType === 'collect') {
      collectionStoreId = storeId || defaultNode.id;
    }

    // Generate order number
    const orderNumber = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

    // Create order
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        organisation_id: cartData.organisation_id,
        fulfilment_node_id: collectionStoreId || defaultNode.id,
        order_number: orderNumber,
        status: 'pending',
        fulfilment_type:
          fulfillmentType === 'delivery' ? 'online_shipping' : 'click_and_collect',
        shipping_address_id: shippingAddressId,
        collection_store_id: collectionStoreId,
        total_amount: 0,
        currency: 'AUD',
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

    // Create order lines from cart lines
    const orderLines = cartData.cart_lines.map((line) => ({
      order_id: order.id,
      sellable_sku_id: line.sellable_sku_id,
      quantity: line.quantity,
      unit_price: line.price_at_add,
      line_total: line.price_at_add * line.quantity,
    }));

    const { error: linesError } = await supabase
      .from('order_lines')
      .insert(orderLines);

    if (linesError) {
      return {
        success: false,
        errors: [
          {
            field: 'order',
            message: 'Failed to create order lines',
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
