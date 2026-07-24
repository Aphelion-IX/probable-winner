"use server";

import { createServerSupabaseClient } from "@/server/supabase";
import { getCartSessionId } from "@/lib/cart-session";

export type AddAllToCartLine = {
  skuId: string;
  quantity: number;
};

export type AddAllToCartResult =
  | { status: "success"; addedCount: number; failedCount: number }
  | { status: "error"; message: string };

type StoreRow = {
  id: string;
  organisation_id: string;
};

// Reserves each resolved line's SKU into a real cart via the atomic
// add_to_cart() database function (backlog B-111) — never manual inventory
// arithmetic in this action, per AGENTS.md rule 2. Lines are added
// sequentially rather than in parallel: they share one cart row, and
// concurrent writes to the same cart/inventory_balances rows risk lock
// contention that isn't worth it for a list this size.
export async function addAllToCart(lines: AddAllToCartLine[]): Promise<AddAllToCartResult> {
  if (lines.length === 0) {
    return { status: "error", message: "Nothing to add." };
  }

  const supabase = createServerSupabaseClient();

  const { data: store, error: storeError } = await supabase
    .from("fulfilment_nodes")
    .select("id, organisation_id")
    .eq("active", true)
    .eq("allows_online_fulfilment", true)
    .limit(1)
    .maybeSingle<StoreRow>();

  if (storeError) {
    return { status: "error", message: `Failed to find a store: ${storeError.message}` };
  }
  if (!store) {
    return { status: "error", message: "No store currently accepts online orders." };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: cart, error: cartError } = await supabase.rpc("get_or_create_cart", {
    p_organisation_id: store.organisation_id,
    p_customer_id: user?.id ?? null,
    p_guest_token: user ? null : await getCartSessionId(),
  });

  if (cartError || !cart) {
    return {
      status: "error",
      message: `Couldn't start a cart: ${cartError?.message ?? "unknown error"}`,
    };
  }

  let addedCount = 0;
  let failedCount = 0;

  for (const line of lines) {
    const { error } = await supabase.rpc("add_to_cart", {
      p_cart_id: cart.id,
      p_fulfilment_node_id: store.id,
      p_sellable_sku_id: line.skuId,
      p_quantity: line.quantity,
    });

    if (error) {
      failedCount += 1;
    } else {
      addedCount += 1;
    }
  }

  return { status: "success", addedCount, failedCount };
}
