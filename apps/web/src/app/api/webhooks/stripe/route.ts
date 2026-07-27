import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return Response.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: errorMessage }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  try {
    // Handle specific event types
    if (event.type === "checkout.session.completed" || event.type === "charge.succeeded") {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.orderId;

      if (orderId) {
        // Call RPC to confirm payment (handles allocation conversion, event storage with idempotency).
        // Stripe's own hosted Checkout page always collects the buyer's
        // email regardless of fulfilment type or sign-in state, so this is
        // passed through for confirm_order_payment() to capture on a guest
        // order (there is otherwise nowhere in checkout today that asks for
        // one) -- optional chaining since charge.succeeded's object has no
        // customer_details field at all, unlike checkout.session.completed's.
        const { error: rpcError } = await supabase.rpc("confirm_order_payment", {
          p_order_id: orderId,
          p_stripe_event_id: event.id,
          p_guest_email: session.customer_details?.email ?? null,
        });

        if (rpcError) {
          console.error(`Failed to confirm payment for order ${orderId}:`, rpcError);
          // AGENTS.md rule 10 / blueprint §16: confirmation is durable state
          // (inventory allocation, order status) that must actually
          // complete. A 200 here would tell Stripe the event was delivered,
          // so it would never retry and this order would be stuck paid-in-
          // Stripe but still 'pending' with its reservation unconverted.
          return Response.json({ received: false, error: rpcError.message }, { status: 500 });
        }

        console.log(`Order ${orderId} payment confirmed via webhook`);
      }
    }

    if (event.type === "charge.failed" || event.type === "checkout.session.expired") {
      const session = event.data.object as Stripe.Checkout.Session | Stripe.Charge;
      const orderId = "metadata" in session ? (session.metadata?.orderId as string) : undefined;

      if (orderId) {
        // Call RPC to release reservations
        const { error: rpcError } = await supabase.rpc("release_failed_order_reservations", {
          p_order_id: orderId,
        });

        if (rpcError) {
          console.error(`Failed to release reservations for order ${orderId}:`, rpcError);
          // Same reasoning as above: a failed release leaves stock stuck
          // reserved against a dead order, unable to be sold, until the
          // reservation's own expiry eventually clears it -- Stripe must
          // retry this rather than being told it succeeded.
          return Response.json({ received: false, error: rpcError.message }, { status: 500 });
        }

        console.log(`Order ${orderId} payment failed/expired, reservations released`);
      }
    }

    return Response.json({ received: true }, { status: 200 });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Webhook processing error:", errorMessage);
    return Response.json({ error: errorMessage }, { status: 500 });
  }
}
