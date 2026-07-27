import { NextResponse } from "next/server";

import { resolveDefaultStore } from "@/lib/cart-session";

// Backs HeaderStoreSelector's initial selection -- without this, the
// header only ever showed whichever store happened to be first in the
// /api/stores list, never the customer's actual saved preference (backlog
// B-090/B-170). Returns the same store add-to-cart would actually reserve
// from, via resolveDefaultStore()'s own preference -> fallback logic.
export async function GET() {
  try {
    const store = await resolveDefaultStore();
    return NextResponse.json({ storeId: store?.id ?? null });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to resolve the current store" },
      { status: 500 },
    );
  }
}
