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
        // Call RPC to confirm payment (handles allocation conversion, event storage with idempotency)
        const { error: rpcError } = await supabase.rpc("confirm_order_payment", {
          order_id: orderId,
          stripe_event_id: event.id,
        });

        if (rpcError) {
          console.error(`Failed to confirm payment for order ${orderId}:`, rpcError);
        } else {
          console.log(`Order ${orderId} payment confirmed via webhook`);
        }
      }
    }

    if (event.type === "charge.failed" || event.type === "checkout.session.expired") {
      const session = event.data.object as Stripe.Checkout.Session | Stripe.Charge;
      const orderId = "metadata" in session ? (session.metadata?.orderId as string) : undefined;

      if (orderId) {
        // Call RPC to release reservations
        const { error: rpcError } = await supabase.rpc("release_failed_order_reservations", {
          order_id: orderId,
        });

        if (rpcError) {
          console.error(`Failed to release reservations for order ${orderId}:`, rpcError);
        } else {
          console.log(`Order ${orderId} payment failed/expired, reservations released`);
        }
      }
    }

    return Response.json({ received: true }, { status: 200 });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Webhook processing error:", errorMessage);
    return Response.json({ error: errorMessage }, { status: 500 });
  }
}
