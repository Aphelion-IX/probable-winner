'use server';

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

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
      return Response.json(
        { success: false, error: 'Order ID is required' },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Fetch order with cart lines
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
            quantity,
            price_at_add,
            sellable_skus(
              id,
              card_printings(
                id,
                card_identities(
                  id,
                  name
                )
              )
            )
          )
        )
      `)
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return Response.json(
        { success: false, error: 'Order not found' },
        { status: 404 }
      );
    }

    // Build line items for Stripe
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cart = Array.isArray(order.carts) ? order.carts[0] : order.carts as any;

    if (cart?.cart_lines) {
      for (const line of cart.cart_lines) {
        const sku = Array.isArray(line.sellable_skus)
          ? line.sellable_skus[0]
          : line.sellable_skus;
        const cardPrinting = Array.isArray(sku?.card_printings)
          ? sku.card_printings[0]
          : sku?.card_printings;
        const cardIdentity = Array.isArray(cardPrinting?.card_identities)
          ? cardPrinting.card_identities[0]
          : cardPrinting?.card_identities;

        lineItems.push({
          price_data: {
            currency: 'aud',
            product_data: {
              name: cardIdentity?.name || 'Trading Card',
              metadata: {
                skuId: line.sellable_sku_id,
              },
            },
            unit_amount: Math.round(line.price_at_add * 100),
          },
          quantity: line.quantity,
        });
      }
    }

    if (lineItems.length === 0) {
      return Response.json(
        { success: false, error: 'Cart is empty' },
        { status: 400 }
      );
    }

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/checkout/payment/${orderId}`,
      metadata: {
        orderId,
      },
    });

    return Response.json({
      success: true,
      sessionUrl: session.url,
    } as CreateSessionResponse);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return Response.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}
