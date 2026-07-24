import { NextResponse } from "next/server";

import { getSkuLiveData } from "@/features/catalogue/queries/get-sku-live-data";

// Every response — success or not-found — must declare no-store: this
// endpoint backs the product page's volatile section (blueprint §14), and a
// SKU that's out of stock now but reserved a moment later must never be
// served from a stale cache entry at any layer.
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const data = await getSkuLiveData(id);

    if (!data) {
      return NextResponse.json(
        { error: "SKU not found" },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }

    return NextResponse.json(data, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load SKU data" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
