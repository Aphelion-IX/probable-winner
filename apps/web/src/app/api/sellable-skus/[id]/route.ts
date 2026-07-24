import { NextResponse } from "next/server";

import { getSkuLiveData } from "@/features/catalogue/queries/get-sku-live-data";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const data = await getSkuLiveData(id);

  if (!data) {
    return NextResponse.json({ error: "SKU not found" }, { status: 404 });
  }

  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
