// Talks to the worker's search HTTP service (apps/worker/src/search/
// http-server.ts) -- the worker is a long-running process that keeps the
// MiniSearch index resident in memory (unlike Typesense, MiniSearch is a
// library, not an external service, so *something* has to hold that state;
// apps/web's serverless functions are the wrong place, since a fresh cold
// start would otherwise need to reload the entire ~800k-document index on
// every invocation). Never cached by Next's fetch cache -- search results
// reflect live stock/price data.
import type { SearchOutcome, SearchQueryParams } from "@probable-winner/search";

function buildSearchUrl(baseUrl: string, params: SearchQueryParams): URL {
  const url = new URL("/search", baseUrl);
  const search = url.searchParams;

  if (params.q) search.set("q", params.q);
  if (params.set) search.set("set", params.set);
  if (params.collectorNumber) search.set("collectorNumber", params.collectorNumber);
  if (params.artist) search.set("artist", params.artist);
  if (params.rarity) search.set("rarity", params.rarity);
  if (params.finish) search.set("finish", params.finish);
  if (params.condition) search.set("condition", params.condition);
  for (const colour of params.colour ?? []) search.append("colour", colour);
  if (params.format) search.set("format", params.format);
  if (params.minPrice !== undefined) search.set("minPrice", String(params.minPrice));
  if (params.maxPrice !== undefined) search.set("maxPrice", String(params.maxPrice));
  if (params.inStock) search.set("inStock", "true");
  if (params.storeId) search.set("storeId", params.storeId);
  if (params.page !== undefined) search.set("page", String(params.page));
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  if (params.sort) search.set("sort", params.sort);

  return url;
}

export async function querySearchService(params: SearchQueryParams): Promise<SearchOutcome> {
  const baseUrl = process.env.SEARCH_SERVICE_URL;
  const token = process.env.SEARCH_SERVICE_TOKEN;

  if (!baseUrl || !token) {
    throw new Error("SEARCH_SERVICE_URL and SEARCH_SERVICE_TOKEN must be set");
  }

  const response = await fetch(buildSearchUrl(baseUrl, params), {
    headers: { "x-search-service-token": token },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Search service returned ${response.status}`);
  }

  return (await response.json()) as SearchOutcome;
}
