"use server";

import { revalidatePath } from "next/cache";

import { createServerSupabaseClient } from "@/server/supabase";
import { getOrCreateCart, resolveDefaultStore } from "@/lib/cart-session";

export interface AddToCartResult {
  success: boolean;
  cartLineId?: string;
  error?: string;
}

// Adds a single SKU to the current customer's (or guest's) cart via the
// atomic add_to_cart() database function (backlog B-111) -- never manual
// inventory arithmetic here, per AGENTS.md rule 2. Resolves the store and
// cart the same way features/deck-builder/actions/add-all-to-cart.ts does,
// so a single "Add to cart" button anywhere in the storefront only needs
// the SKU id and a quantity.
export async function addToCart(sellableSkuId: string, quantity: number): Promise<AddToCartResult> {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { success: false, error: "Quantity must be a positive whole number" };
  }

  try {
    const store = await resolveDefaultStore();
    if (!store) {
      return { success: false, error: "No store currently accepts online orders" };
    }

    const cart = await getOrCreateCart(store.organisation_id);

    const supabase = createServerSupabaseClient();
    const { data: line, error } = await supabase.rpc("add_to_cart", {
      p_cart_id: cart.id,
      p_fulfilment_node_id: store.id,
      p_sellable_sku_id: sellableSkuId,
      p_quantity: quantity,
    });

    if (error || !line) {
      return { success: false, error: error?.message ?? "Failed to add item to cart" };
    }

    revalidatePath("/cart");

    return { success: true, cartLineId: line.id };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
