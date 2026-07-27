import { cookies } from "next/headers";

import { createServerSupabaseClient } from "@/server/supabase";

const CART_SESSION_COOKIE = "cart_session_id";
const CART_SESSION_DURATION = 30 * 24 * 60 * 60 * 1000; // 30 days

const PREFERRED_STORE_COOKIE = "preferred_store_id";
const PREFERRED_STORE_COOKIE_DURATION = 180 * 24 * 60 * 60; // 180 days, in seconds

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

/**
 * Reads the guest cart cookie without creating one.
 *
 * getCartSessionId() mints and sets a fresh token when the cookie is absent,
 * which is right on a write path (add-to-cart needs a cart to exist) but
 * wrong on an authorisation check: minting a token there would hand the
 * caller a brand-new identity mid-check, and a newly minted token can never
 * match an existing order anyway.
 */
export async function readCartSessionId(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(CART_SESSION_COOKIE)?.value ?? null;
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

/**
 * Reads a guest's preferred-store cookie without creating one. Mirrors
 * readCartSessionId()'s read-only shape -- an absent cookie just means "no
 * guest preference set yet", not something to mint a default for here.
 */
export async function getPreferredStoreCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(PREFERRED_STORE_COOKIE)?.value ?? null;
}

export async function setPreferredStoreCookie(storeId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(PREFERRED_STORE_COOKIE, storeId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: PREFERRED_STORE_COOKIE_DURATION,
    path: "/",
  });
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

type PreferredStoreLookup = { preferred_fulfilment_node_id: string | null };

// The store a cart/reservation is fulfilled from. Prefers, in order: an
// authenticated customer's profiles.preferred_fulfilment_node_id (set via
// the account page's store picker -- ProfileEditor/updateProfile, backlog
// B-170 -- which already wrote this column but nothing ever read it back);
// a guest's preferred_store_id cookie (set via HeaderStoreSelector calling
// selectPreferredStore()); and only then the first active store that
// accepts online orders, the same fallback used before either preference
// mechanism fed into this function. A preference that no longer names an
// active, online-fulfilling store (closed, or stopped taking online
// orders) is silently skipped rather than failing the whole flow -- it
// falls through to that same default.
export async function resolveDefaultStore(): Promise<ActiveStore | null> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let preferredId: string | null = null;

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("preferred_fulfilment_node_id")
      .eq("id", user.id)
      .maybeSingle<PreferredStoreLookup>();
    preferredId = profile?.preferred_fulfilment_node_id ?? null;
  } else {
    preferredId = await getPreferredStoreCookie();
  }

  if (preferredId) {
    const { data: preferred, error: preferredError } = await supabase
      .from("fulfilment_nodes")
      .select("id, organisation_id")
      .eq("id", preferredId)
      .eq("active", true)
      .eq("allows_online_fulfilment", true)
      .maybeSingle<ActiveStore>();

    if (preferredError) {
      throw new Error(`Failed to resolve a store: ${preferredError.message}`);
    }
    if (preferred) {
      return preferred;
    }
  }

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
  const supabase = await createServerSupabaseClient();

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
