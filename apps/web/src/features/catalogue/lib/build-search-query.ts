// Pure Typesense query-building for the search API route (B-084, blueprint
// §13.4). Kept free of the Typesense client itself so the filter/sort
// logic is testable without a live search index.

export type SearchQueryParams = {
  q?: string;
  set?: string;
  collectorNumber?: string;
  artist?: string;
  rarity?: string;
  finish?: string;
  condition?: string;
  colour?: string[];
  format?: string;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
  storeId?: string;
  page?: number;
  limit?: number;
  sort?: "relevance" | "price_asc" | "price_desc" | "popularity";
};

// Typesense uses a backtick to quote filter values containing spaces/
// special characters (e.g. artist:=`Jesper Ejsing`) — strip any backticks
// from user input first so a value can't escape its own quoting.
function sanitizeFilterValue(value: string): string {
  return value.replace(/`/g, "");
}

function exactFilter(field: string, value: string): string {
  return `${field}:=\`${sanitizeFilterValue(value)}\``;
}

export function buildFilterBy(params: SearchQueryParams): string | undefined {
  const clauses: string[] = [];

  if (params.set) clauses.push(exactFilter("set_code", params.set));
  if (params.collectorNumber) clauses.push(exactFilter("collector_number", params.collectorNumber));
  if (params.artist) clauses.push(exactFilter("artist", params.artist));
  if (params.rarity) clauses.push(exactFilter("rarity", params.rarity));
  if (params.finish) clauses.push(exactFilter("finish", params.finish));
  if (params.condition) clauses.push(exactFilter("condition", params.condition));

  if (params.colour && params.colour.length > 0) {
    const sanitized = params.colour.map(sanitizeFilterValue);
    clauses.push(`colour_identity:=[${sanitized.join(",")}]`);
  }

  // Format legality is a nested object field (legality.standard, etc.) —
  // dot notation reaches into it without needing a live Postgres join
  // (blueprint §20's "one database request per search result" prohibition).
  if (params.format) clauses.push(`legality.${sanitizeFilterValue(params.format)}:=legal`);

  if (params.minPrice !== undefined) clauses.push(`price_amount:>=${params.minPrice}`);
  if (params.maxPrice !== undefined) clauses.push(`price_amount:<=${params.maxPrice}`);
  if (params.inStock) clauses.push("quantity_available:>0");

  // Same nested-field approach for per-store availability.
  if (params.storeId) clauses.push(`quantity_in_stores.${sanitizeFilterValue(params.storeId)}:>0`);

  return clauses.length > 0 ? clauses.join(" && ") : undefined;
}

export function buildSortBy(sort: SearchQueryParams["sort"]): string | undefined {
  switch (sort) {
    case "price_asc":
      return "price_amount:asc";
    case "price_desc":
      return "price_amount:desc";
    case "popularity":
      return "popularity_score:desc";
    case "relevance":
    default:
      // Typesense's default: text match score, falling back to the
      // collection's default_sorting_field (popularity_score).
      return undefined;
  }
}
