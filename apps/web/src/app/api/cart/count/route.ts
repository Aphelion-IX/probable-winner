import { NextResponse } from "next/server";

import { getCartContents } from "@/features/cart/queries/get-cart-contents";

// Backs the header's cart badge. Deliberately a route handler fetched
// client-side (like /api/stores) rather than a Server Component read
// inside the shared layout: reading the cart session cookie there would
// force every page under that layout into dynamic rendering (no PPR/Cache
// Components in this app -- see docs/architecture.md and AGENTS.md's
// framework-version note), undoing the "cache aggressively" work on the
// card identity/sets/home pages.
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const cart = await getCartContents();
    const count = cart.lines.reduce((total, line) => total + line.quantity, 0);
    return NextResponse.json({ count }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load cart count" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
