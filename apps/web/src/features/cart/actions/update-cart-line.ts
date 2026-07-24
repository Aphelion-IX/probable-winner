"use server";

import { revalidatePath } from "next/cache";

import { createServerSupabaseClient } from "@/server/supabase";

export type UpdateCartLineResult = { success: true } | { success: false; error: string };

// Changes a cart line's quantity via the atomic update_cart_line_quantity()
// database function (backlog B-111) -- never manual inventory arithmetic in
// a component, per AGENTS.md rule 2. A new quantity of 0 removes the line
// (the database function's own behaviour), so the UI doesn't need to
// special-case "set to zero" vs. "remove".
export async function updateCartLineQuantity(
  cartLineId: string,
  quantity: number,
): Promise<UpdateCartLineResult> {
  if (!Number.isInteger(quantity) || quantity < 0) {
    return { success: false, error: "Quantity must be a non-negative whole number" };
  }

  const supabase = createServerSupabaseClient();
  const { error } = await supabase.rpc("update_cart_line_quantity", {
    p_cart_line_id: cartLineId,
    p_new_quantity: quantity,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/cart");
  return { success: true };
}

export async function removeCartLine(cartLineId: string): Promise<UpdateCartLineResult> {
  const supabase = createServerSupabaseClient();
  const { error } = await supabase.rpc("remove_cart_line", { p_cart_line_id: cartLineId });

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/cart");
  return { success: true };
}
