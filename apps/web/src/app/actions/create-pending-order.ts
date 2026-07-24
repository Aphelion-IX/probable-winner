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
    inventory_reservation_id: string;
    inventory_reservations: { id: string; expires_at: string } | null;
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

  // Fetch cart with organisation and items. cart_lines has no stored
  // price -- unlike order_lines (fixed at order time), a cart line's
  // price is always looked up fresh from published_prices at checkout,
  // so there's no "price at add" to detect drift against.
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
        inventory_reservation_id,
        inventory_reservations(
          id,
          expires_at
        )
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

  // Fetch current published prices for every line's SKU (fresh lookup,
  // not a stored value on the cart line).
  const priceBySkuId = new Map<string, number>();
  if (cartData?.cart_lines?.length) {
    const skuIds = cartData.cart_lines.map((line) => line.sellable_sku_id);
    const { data: prices } = await supabase
      .from('published_prices')
      .select('sellable_sku_id, final_amount')
      .in('sellable_sku_id', skuIds)
      .eq('status', 'active');

    for (const price of prices ?? []) {
      priceBySkuId.set(price.sellable_sku_id, price.final_amount);
    }
  }

  // Validate cart contents
  if (cartData?.id) {
    const now = new Date();
    for (const line of cartData.cart_lines) {
      const reservation = Array.isArray(line.inventory_reservations)
        ? line.inventory_reservations[0]
        : line.inventory_reservations;

      if (
        !reservation ||
        (reservation.expires_at && new Date(reservation.expires_at) < now)
      ) {
        errors.push({
          field: `cartLine_${line.id}`,
          message: 'Item reservation has expired. Please add it to cart again.',
        });
      }

      if (!priceBySkuId.has(line.sellable_sku_id)) {
        errors.push({
          field: `cartLine_${line.id}_price`,
          message: 'This item is no longer available for sale. Please remove it and try again.',
        });
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
          // The checkout address form doesn't collect a recipient name yet
          // (a pre-existing gap in this UI, not something this fix adds) --
          // recipient_name is NOT NULL with no default, so fall back rather
          // than fail the insert outright.
          recipient_name: 'Customer',
          line_1: address.line1,
          line_2: address.line2 || null,
          suburb_city: address.suburb,
          state_province: address.state,
          postcode_zip: address.postcode,
          country_code: 'AU',
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

    // Create order lines from cart lines, at the price validated above.
    const orderLines = cartData.cart_lines.map((line) => {
      const unitPrice = priceBySkuId.get(line.sellable_sku_id) ?? 0;
      return {
        order_id: order.id,
        sellable_sku_id: line.sellable_sku_id,
        quantity: line.quantity,
        unit_price: unitPrice,
        line_total: Math.round(unitPrice * line.quantity * 100) / 100,
      };
    });

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

    // Roll up the lines just inserted into the order's total (created
    // with a 0 placeholder above since the total depends on them).
    const totalAmount =
      Math.round(orderLines.reduce((sum, line) => sum + line.line_total, 0) * 100) / 100;
    await supabase.from('orders').update({ total_amount: totalAmount }).eq('id', order.id);

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
