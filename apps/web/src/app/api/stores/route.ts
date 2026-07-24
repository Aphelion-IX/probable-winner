import { NextResponse } from "next/server";

import { listActiveStores } from "@/features/customer/queries/list-active-stores";

// Backs the navbar StoreSelector, which previously fetched this endpoint
// with no route handler behind it at all (a silent 404 on every page load).
export async function GET() {
  try {
    const stores = await listActiveStores();
    return NextResponse.json(stores);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load stores" },
      { status: 500 },
    );
  }
}
