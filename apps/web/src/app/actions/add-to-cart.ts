"use server";

import { createClient } from "@supabase/supabase-js";

interface AddToCartResult {
  success: boolean;
  cartLineId?: string;
  error?: string;
}

export async function addToCart(
  cartId: string,
  sellableSkuId: string,
  quantity: number,
  nodeId: string,
): Promise<AddToCartResult> {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // Validate cart exists and belongs to user
    const { data: cart, error: cartError } = await supabase
      .from("carts")
      .select("id, customer_id")
      .eq("id", cartId)
      .single();

    if (cartError || !cart) {
      return { success: false, error: "Cart not found" };
    }

    // Validate SKU exists
    const { data: sku, error: skuError } = await supabase
      .from("sellable_skus")
      .select("id")
      .eq("id", sellableSkuId)
      .single();

    if (skuError || !sku) {
      return { success: false, error: "SKU not found" };
    }

    // Reserve inventory (atomic operation via database function). Price is
    // looked up fresh at checkout time from published_prices, not stored
    // on the cart line -- cart_lines has no price_at_add column.
    const { data: reservation, error: reserveError } = await supabase.rpc("reserve_inventory", {
      p_sellable_sku_id: sellableSkuId,
      p_fulfilment_node_id: nodeId,
      p_quantity: quantity,
    });

    if (reserveError) {
      return { success: false, error: reserveError.message || "Failed to reserve inventory" };
    }

    if (!reservation?.id) {
      return { success: false, error: "Inventory unavailable" };
    }

    // Add line to cart
    const { data: cartLine, error: insertError } = await supabase
      .from("cart_lines")
      .insert({
        cart_id: cartId,
        fulfilment_node_id: nodeId,
        sellable_sku_id: sellableSkuId,
        inventory_reservation_id: reservation.id,
        quantity,
      })
      .select("id")
      .single();

    if (insertError) {
      // If cart line insert fails, we should release the reservation
      await supabase.rpc("release_inventory_reservation", {
        p_reservation_id: reservation.id,
      });
      return { success: false, error: "Failed to add item to cart" };
    }

    return { success: true, cartLineId: cartLine.id };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
