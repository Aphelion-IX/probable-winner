import { NextRequest, NextResponse } from "next/server";

import { searchCardPrintings } from "@/features/catalogue/queries/search-card-printings";

// Backs the alert-creation form's card autocomplete (backlog B-191).
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";

  try {
    const results = await searchCardPrintings(q);
    return NextResponse.json(results);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to search card printings" },
      { status: 500 },
    );
  }
}
