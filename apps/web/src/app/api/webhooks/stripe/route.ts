import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return Response.json({ error: 'Missing signature' }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return Response.json({ error: errorMessage }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    // Store event with idempotency (event_id as primary key)
    const { error: insertError } = await supabase
      .from('stripe_events')
      .upsert({
        id: event.id,
        event_type: event.type,
        event_data: event.data,
      });

    if (insertError) {
      console.error('Failed to store Stripe event:', insertError);
      return Response.json(
        { error: 'Failed to store event' },
        { status: 500 }
      );
    }

    // Handle specific event types
    if (
      event.type === 'checkout.session.completed' ||
      event.type === 'charge.succeeded'
    ) {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.orderId;

      if (orderId) {
        // Update order status to paid
        await supabase
          .from('orders')
          .update({ status: 'paid' })
          .eq('id', orderId);

        // Queue event for allocation conversion (B-125)
        // This would typically emit to a Supabase Queue, but for now we'll log it
        console.log(`Order ${orderId} marked as paid, ready for allocation conversion`);
      }
    }

    if (
      event.type === 'charge.failed' ||
      event.type === 'checkout.session.expired'
    ) {
      const session = event.data.object as
        | Stripe.Checkout.Session
        | Stripe.Charge;
      const orderId =
        'metadata' in session
          ? (session.metadata?.orderId as string)
          : undefined;

      if (orderId) {
        // Mark order as cancelled and release reservations (B-126)
        await supabase
          .from('orders')
          .update({ status: 'cancelled' })
          .eq('id', orderId);

        console.log(
          `Order ${orderId} failed/expired, reservations should be released`
        );
      }
    }

    return Response.json({ received: true }, { status: 200 });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Webhook processing error:', errorMessage);
    return Response.json({ error: errorMessage }, { status: 500 });
  }
}
