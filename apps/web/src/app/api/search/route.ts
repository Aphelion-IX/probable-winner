// Search API route handler (B-084, blueprint §13.4)
// Route handler, not a Server Action, per blueprint §19. Queries the
// worker's search service — never Postgres per search request (blueprint
// §20's explicit "querying PostgreSQL on every search keystroke"
// prohibition).

import { NextRequest, NextResponse } from "next/server";

import { type SearchQueryParams } from "@probable-winner/search";
import { searchCards } from "@/features/catalogue/queries/search-cards";

function parseSearchParams(request: NextRequest): SearchQueryParams {
  const { searchParams } = new URL(request.url);

  return {
    q: searchParams.get("q") || undefined,
    set: searchParams.get("set") || undefined,
    collectorNumber: searchParams.get("collectorNumber") || undefined,
    artist: searchParams.get("artist") || undefined,
    rarity: searchParams.get("rarity") || undefined,
    finish: searchParams.get("finish") || undefined,
    condition: searchParams.get("condition") || undefined,
    colour: searchParams.getAll("colour"),
    format: searchParams.get("format") || undefined,
    minPrice: searchParams.get("minPrice") ? Number(searchParams.get("minPrice")) : undefined,
    maxPrice: searchParams.get("maxPrice") ? Number(searchParams.get("maxPrice")) : undefined,
    inStock: searchParams.get("inStock") === "true",
    storeId: searchParams.get("storeId") || undefined,
    page: searchParams.get("page") ? Number(searchParams.get("page")) : 1,
    limit: Math.min(Number(searchParams.get("limit") || 20), 100),
    sort: (searchParams.get("sort") as SearchQueryParams["sort"] | null) ?? "relevance",
  };
}

export async function GET(request: NextRequest) {
  try {
    const params = parseSearchParams(request);
    const result = await searchCards(params);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Search failed" },
      { status: 500 },
    );
  }
}
