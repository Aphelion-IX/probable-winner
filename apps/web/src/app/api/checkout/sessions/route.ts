"use server";

import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

interface CreateSessionRequest {
  orderId: string;
}

interface CreateSessionResponse {
  success: boolean;
  sessionUrl?: string;
  error?: string;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body: CreateSessionRequest = await request.json();
    const { orderId } = body;

    if (!orderId) {
      return Response.json({ success: false, error: "Order ID is required" }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // Fetch order lines directly -- orders has no cart_id (an order isn't
    // linked back to the cart it was created from), so line items come
    // from order_lines (fixed at order-creation time), not the cart.
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, status")
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      return Response.json({ success: false, error: "Order not found" }, { status: 404 });
    }

    const { data: orderLines, error: linesError } = await supabase
      .from("order_lines")
      .select(
        `
        id,
        sellable_sku_id,
        quantity,
        unit_price,
        sellable_skus(
          id,
          card_printings(
            id,
            oracle_cards(
              id,
              name
            )
          )
        )
      `,
      )
      .eq("order_id", orderId);

    if (linesError) {
      return Response.json(
        { success: false, error: "Failed to load order lines" },
        { status: 500 },
      );
    }

    // Build line items for Stripe
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];

    for (const line of orderLines ?? []) {
      const sku = Array.isArray(line.sellable_skus) ? line.sellable_skus[0] : line.sellable_skus;
      const cardPrinting = Array.isArray(sku?.card_printings)
        ? sku.card_printings[0]
        : sku?.card_printings;
      const oracleCard = Array.isArray(cardPrinting?.oracle_cards)
        ? cardPrinting.oracle_cards[0]
        : cardPrinting?.oracle_cards;

      lineItems.push({
        price_data: {
          currency: "aud",
          product_data: {
            name: oracleCard?.name || "Trading Card",
            metadata: {
              skuId: line.sellable_sku_id,
            },
          },
          // Stripe wants integer cents; the DB stores dollar amounts.
          unit_amount: Math.round(line.unit_price * 100),
        },
        quantity: line.quantity,
      });
    }

    if (lineItems.length === 0) {
      return Response.json({ success: false, error: "Cart is empty" }, { status: 400 });
    }

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: lineItems,
      mode: "payment",
      success_url: `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/checkout/payment/${orderId}`,
      metadata: {
        orderId,
      },
    });

    return Response.json({
      success: true,
      sessionUrl: session.url,
    } as CreateSessionResponse);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ success: false, error: errorMessage }, { status: 500 });
  }
}
