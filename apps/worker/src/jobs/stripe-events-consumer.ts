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
  const { id: eventId, event_type, order_id } = event;

  if (
    event_type === 'charge.succeeded' ||
    event_type === 'checkout.session.completed'
  ) {
    await handlePaymentSuccess(order_id, eventId);
  } else if (
    event_type === 'charge.failed' ||
    event_type === 'checkout.session.expired'
  ) {
    await handlePaymentFailure(order_id);
  }
}

async function handlePaymentSuccess(
  orderId: string,
  stripeEventId?: string
) {
  try {
    // Call RPC function to confirm payment (handles idempotency, allocation conversion, event emission)
    const { data: result, error: rpcError } = await supabase.rpc(
      'confirm_order_payment',
      {
        order_id: orderId,
        stripe_event_id: stripeEventId || `stripe_${Date.now()}`,
      }
    );

    if (rpcError) {
      console.error(
        `Failed to confirm payment for order ${orderId}:`,
        rpcError
      );
      return;
    }

    console.log(
      `Order ${orderId} payment confirmed:`,
      result
    );
  } catch (error) {
    console.error(
      `Error processing payment success for order ${orderId}:`,
      error
    );
  }
}

async function handlePaymentFailure(orderId: string) {
  try {
    // Call RPC function to release reservations (handles idempotency and event emission)
    const { data: result, error: rpcError } = await supabase.rpc(
      'release_failed_order_reservations',
      {
        order_id: orderId,
      }
    );

    if (rpcError) {
      console.error(
        `Failed to release reservations for order ${orderId}:`,
        rpcError
      );
      return;
    }

    console.log(
      `Order ${orderId} payment failed, reservations released:`,
      result
    );
  } catch (error) {
    console.error(
      `Error processing payment failure for order ${orderId}:`,
      error
    );
  }
}
