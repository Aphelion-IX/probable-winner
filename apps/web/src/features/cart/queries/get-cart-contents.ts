import { createServerSupabaseClient } from "@/server/supabase";
import { getCartSessionId } from "@/lib/cart-session";

export type CartContentsLine = {
  cartLineId: string;
  cartId: string;
  sellableSkuId: string;
  fulfilmentNodeId: string;
  quantity: number;
  reservationExpiresAt: string | null;
  cardName: string;
  setCode: string;
  rarity: string;
  finishCode: string;
  finishName: string;
  conditionCode: string;
  conditionName: string;
  price: number | null;
  currency: string | null;
};

export type CartContents = {
  cartId: string | null;
  lines: CartContentsLine[];
  subtotal: number;
};

type CartContentsRow = {
  cart_line_id: string;
  cart_id: string;
  sellable_sku_id: string;
  fulfilment_node_id: string;
  quantity: number;
  reservation_expires_at: string | null;
  card_name: string;
  set_code: string;
  rarity: string;
  finish_code: string;
  finish_name: string;
  condition_code: string;
  condition_name: string;
  price: number | null;
  currency: string | null;
};

// Reads the current customer's (or guest's) cart via the get_cart_contents()
// database function -- carts have no raw-table RLS for guest carts (see
// 20260723070153_carts.sql), so this RPC, not a direct .from("cart_lines")
// select, is the only correct read path here.
export async function getCartContents(): Promise<CartContents> {
  const supabase = createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase.rpc("get_cart_contents", {
    p_guest_token: user ? null : await getCartSessionId(),
  });

  if (error) {
    throw new Error(`Failed to load cart: ${error.message}`);
  }

  const rows = (data ?? []) as CartContentsRow[];

  const lines: CartContentsLine[] = rows.map((row) => ({
    cartLineId: row.cart_line_id,
    cartId: row.cart_id,
    sellableSkuId: row.sellable_sku_id,
    fulfilmentNodeId: row.fulfilment_node_id,
    quantity: row.quantity,
    reservationExpiresAt: row.reservation_expires_at,
    cardName: row.card_name,
    setCode: row.set_code,
    rarity: row.rarity,
    finishCode: row.finish_code,
    finishName: row.finish_name,
    conditionCode: row.condition_code,
    conditionName: row.condition_name,
    price: row.price,
    currency: row.currency,
  }));

  return {
    cartId: lines[0]?.cartId ?? null,
    lines,
    subtotal: lines.reduce((total, line) => total + (line.price ?? 0) * line.quantity, 0),
  };
}
