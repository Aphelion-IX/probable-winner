// Shared search query used by both the /api/search route handler (for
// client-side fetches, e.g. header search-as-you-type) and the /search page's
// server component. The server component must call this directly rather than
// fetching its own API route: an RSC doing `fetch("http://localhost:3000/...")`
// has no server to reach on Vercel (each request runs in an isolated
// serverless function, not a persistent localhost listener), so a self-fetch
// fails in production even though the same query works fine hit directly.
import {
  createTypesenseClient,
  CARDS_COLLECTION_NAME,
  type CardSearchDocument,
} from "@probable-winner/search";

import { buildFilterBy, buildSortBy, type SearchQueryParams } from "@/features/catalogue/lib/build-search-query";

export interface SearchCardsResult {
  hits: {
    id: string;
    name: string;
    set: string;
    rarity: string;
    artist: string;
    condition: string;
    finish: string;
    price: number;
  }[];
  page: number;
  pageSize: number;
  totalHits: number;
  totalPages: number;
  processingTimeMs: number;
}

export async function searchCards(params: SearchQueryParams): Promise<SearchCardsResult> {
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

  return {
    hits,
    page,
    pageSize: perPage,
    totalHits: response.found,
    totalPages: Math.ceil(response.found / perPage),
    processingTimeMs: response.search_time_ms,
  };
}
