import { createServerSupabaseClient } from "./supabase";
import { readCartSessionId } from "@/lib/cart-session";

/**
 * Who the current request is acting as, in the two-owner model carts and
 * orders share: a signed-in customer, or an anonymous guest holding the
 * httpOnly cart_session_id cookie.
 *
 * Exactly one of the two is meaningful for any given request. Both being
 * null means the caller has no identity at all and therefore owns nothing.
 */
export interface CheckoutIdentity {
  userId: string | null;
  guestToken: string | null;
}

/** A row carrying the shared carts/orders ownership columns. */
export interface OwnedResource {
  customer_id: string | null;
  guest_token: string | null;
}

export async function resolveCheckoutIdentity(): Promise<CheckoutIdentity> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return {
    userId: user?.id ?? null,
    // Read-only: an authorisation check must never mint a new guest token.
    guestToken: await readCartSessionId(),
  };
}

/**
 * Whether `identity` owns `resource`.
 *
 * Fails closed. Every branch requires a non-null value on *both* sides
 * before comparing, so the dangerous degenerate cases — an ownerless row
 * (both columns null, e.g. an order created before ownership was recorded)
 * and an identity-less caller (no session, no cookie) — can never satisfy a
 * `null === null` comparison and be read as a match.
 *
 * A guest token is accepted whether or not the caller is also signed in:
 * holding the cookie is what the cart itself already treats as proof of
 * ownership, and a customer who built a basket before signing in still
 * legitimately holds it.
 */
export function ownsResource(resource: OwnedResource, identity: CheckoutIdentity): boolean {
  if (resource.customer_id !== null && identity.userId !== null) {
    return resource.customer_id === identity.userId;
  }

  if (resource.guest_token !== null && identity.guestToken !== null) {
    return resource.guest_token === identity.guestToken;
  }

  return false;
}
