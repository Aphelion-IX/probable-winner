// Search API route handler (B-084, blueprint §13.4)
// Route handler, not a Server Action, per blueprint §19. Queries the real
// Typesense index — never Postgres per search request (blueprint §20's
// explicit "querying PostgreSQL on every search keystroke" prohibition).

import { NextRequest, NextResponse } from "next/server";
import { createTypesenseClient, CARDS_COLLECTION_NAME, type CardSearchDocument } from "@probable-winner/search";

import { buildFilterBy, buildSortBy, type SearchQueryParams } from "@/features/catalogue/lib/build-search-query";

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
    sort:
      (searchParams.get("sort") as SearchQueryParams["sort"] | null) ?? "relevance",
  };
}

export async function GET(request: NextRequest) {
  try {
    const params = parseSearchParams(request);
    const page = params.page || 1;
    const perPage = params.limit || 20;

    const client = createTypesenseClient();
    const filterBy = buildFilterBy(params);
    const sortBy = buildSortBy(params.sort);

    const response = await client
      .collections<CardSearchDocument>(CARDS_COLLECTION_NAME)
      .documents()
      .search({
        q: params.q?.trim() || "*",
        query_by: "name",
        ...(filterBy ? { filter_by: filterBy } : {}),
        ...(sortBy ? { sort_by: sortBy } : {}),
        page,
        per_page: perPage,
      });

    const hits = (response.hits ?? []).map((hit) => ({
      id: hit.document.id,
      name: hit.document.name,
      set: hit.document.set_code,
      rarity: hit.document.rarity,
      artist: hit.document.artist,
      condition: hit.document.condition,
      finish: hit.document.finish,
      price: hit.document.price_amount,
    }));

    return NextResponse.json({
      hits,
      page,
      pageSize: perPage,
      totalHits: response.found,
      totalPages: Math.ceil(response.found / perPage),
      processingTimeMs: response.search_time_ms,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Search failed" },
      { status: 500 },
    );
  }
}
