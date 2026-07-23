import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface StripeEvent {
  id: string;
  event_type: string;
  order_id: string;
}

export async function processStripeEvent(event: StripeEvent) {
  const { event_type, order_id } = event;

  if (event_type === 'charge.succeeded' || event_type === 'checkout.session.completed') {
    await handlePaymentSuccess(order_id);
  } else if (event_type === 'charge.failed' || event_type === 'checkout.session.expired') {
    await handlePaymentFailure(order_id);
  }
}

async function handlePaymentSuccess(orderId: string) {
  try {
    // Fetch order with its cart lines
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select(`
        id,
        status,
        cart_id,
        carts(
          id,
          cart_lines(
            id,
            sellable_sku_id,
            reservation_id
          )
        )
      `)
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      console.error(`Order ${orderId} not found for payment success`);
      return;
    }

    if (order.status === 'paid') {
      console.log(`Order ${orderId} already marked as paid, skipping conversion`);
      return;
    }

    // Convert reservations to allocations for each cart line
    const cart = Array.isArray(order.carts) ? order.carts[0] : order.carts;

    if (!cart?.cart_lines) {
      console.warn(`No cart lines found for order ${orderId}`);
      return;
    }

    for (const line of cart.cart_lines) {
      if (!line.reservation_id) {
        console.warn(`No reservation found for cart line ${line.id}`);
        continue;
      }

      // Call RPC function to convert reservation to allocation
      const { error: conversionError } = await supabase.rpc(
        'convert_reservation_to_allocation',
        {
          reservation_id: line.reservation_id,
          order_id: orderId,
        }
      );

      if (conversionError) {
        console.error(
          `Failed to convert reservation ${line.reservation_id}:`,
          conversionError
        );
      }
    }

    // Update order status to paid
    const { error: updateError } = await supabase
      .from('orders')
      .update({ status: 'paid' })
      .eq('id', orderId);

    if (updateError) {
      console.error(`Failed to update order ${orderId} status:`, updateError);
      return;
    }

    // Emit order_paid integration event
    await supabase.from('integration_events').insert({
      aggregate_type: 'Order',
      aggregate_id: orderId,
      event_type: 'order_paid',
      payload: {
        orderId,
      },
    });

    console.log(`Order ${orderId} payment confirmed and allocations created`);
  } catch (error) {
    console.error(
      `Error processing payment success for order ${orderId}:`,
      error
    );
  }
}

async function handlePaymentFailure(orderId: string) {
  try {
    // Fetch order with reservations
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select(`
        id,
        status,
        cart_id,
        carts(
          id,
          cart_lines(
            id,
            reservation_id
          )
        )
      `)
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      console.error(`Order ${orderId} not found for payment failure`);
      return;
    }

    // Release all reservations
    const cart = Array.isArray(order.carts) ? order.carts[0] : order.carts;

    if (cart?.cart_lines) {
      for (const line of cart.cart_lines) {
        if (line.reservation_id) {
          const { error: releaseError } = await supabase
            .from('inventory_reservations')
            .update({ status: 'released' })
            .eq('id', line.reservation_id);

          if (releaseError) {
            console.error(
              `Failed to release reservation ${line.reservation_id}:`,
              releaseError
            );
          }
        }
      }
    }

    // Mark order as cancelled
    const { error: updateError } = await supabase
      .from('orders')
      .update({ status: 'cancelled' })
      .eq('id', orderId);

    if (updateError) {
      console.error(`Failed to cancel order ${orderId}:`, updateError);
      return;
    }

    console.log(`Order ${orderId} payment failed, reservations released`);
  } catch (error) {
    console.error(
      `Error processing payment failure for order ${orderId}:`,
      error
    );
  }
}
