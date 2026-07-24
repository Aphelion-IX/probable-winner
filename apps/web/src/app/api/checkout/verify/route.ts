import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

interface VerifyRequest {
  sessionId: string;
}

export async function POST(request: Request) {
  try {
    const body: VerifyRequest = await request.json();
    const { sessionId } = body;

    if (!sessionId) {
      return Response.json({ success: false, error: "Session ID is required" }, { status: 400 });
    }

    // Retrieve session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (!session) {
      return Response.json({ success: false, error: "Session not found" }, { status: 404 });
    }

    // Check if payment was successful
    if (session.payment_status !== "paid") {
      return Response.json({ success: false, error: "Payment not completed" }, { status: 400 });
    }

    const orderId = session.metadata?.orderId;

    if (!orderId) {
      return Response.json(
        { success: false, error: "Order ID not found in session" },
        { status: 400 },
      );
    }

    // Verify order exists and update if needed
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const { data: order } = await supabase
      .from("orders")
      .select("id, status")
      .eq("id", orderId)
      .single();

    if (!order) {
      return Response.json({ success: false, error: "Order not found" }, { status: 404 });
    }

    return Response.json({
      success: true,
      orderId,
      status: order.status,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ success: false, error: errorMessage }, { status: 500 });
  }
}
