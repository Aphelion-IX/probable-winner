import { cookies } from "next/headers";

import { createServerSupabaseClient } from "@/server/supabase";

const CART_SESSION_COOKIE = "cart_session_id";
const CART_SESSION_DURATION = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function getCartSessionId(): Promise<string> {
  const cookieStore = await cookies();
  let sessionId = cookieStore.get(CART_SESSION_COOKIE)?.value;

  if (!sessionId) {
    // Generate a new session ID for guest checkout
    sessionId = generateSessionId();
    cookieStore.set(CART_SESSION_COOKIE, sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: CART_SESSION_DURATION / 1000, // Convert to seconds
      path: "/",
    });
  }

  return sessionId;
}

export async function setCartSessionId(sessionId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(CART_SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: CART_SESSION_DURATION / 1000,
    path: "/",
  });
}

export async function clearCartSessionId(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(CART_SESSION_COOKIE);
}

function generateSessionId(): string {
  // Must be a real UUID: it's used as guest_token, a `uuid` column/param
  // throughout the cart schema (e.g. get_or_create_cart()) that rejects
  // anything else.
  return crypto.randomUUID();
}

export type ActiveStore = {
  id: string;
  organisation_id: string;
};

export type CartRow = {
  id: string;
  organisation_id: string;
  customer_id: string | null;
  guest_token: string | null;
  status: string;
};

// The store a cart/reservation is fulfilled from. There's no durable
// "customer's chosen store" mechanism yet (the navbar's StoreSelector is
// local-state only and isn't wired into any write path), so every
// unauthenticated add-to-cart flow reserves from the same sensible
// default: the first active store that accepts online orders.
export async function resolveDefaultStore(): Promise<ActiveStore | null> {
  const supabase = createServerSupabaseClient();

  const { data: store, error } = await supabase
    .from("fulfilment_nodes")
    .select("id, organisation_id")
    .eq("active", true)
    .eq("allows_online_fulfilment", true)
    .limit(1)
    .maybeSingle<ActiveStore>();

  if (error) {
    throw new Error(`Failed to resolve a store: ${error.message}`);
  }

  return store ?? null;
}

// Real cart resolution via the get_or_create_cart() database function
// (blueprint §8.7/§10, backlog B-110) -- carts have no raw-table RLS for
// guest carts (see 20260723070153_carts.sql), so this RPC is the only
// correct way to obtain a cart id for either an authenticated customer or
// a guest.
export async function getOrCreateCart(organisationId: string): Promise<CartRow> {
  const supabase = createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: cart, error } = await supabase.rpc("get_or_create_cart", {
    p_organisation_id: organisationId,
    p_customer_id: user?.id ?? null,
    p_guest_token: user ? null : await getCartSessionId(),
  });

  if (error || !cart) {
    throw new Error(error?.message ?? "Failed to get or create cart");
  }

  return cart as CartRow;
}
