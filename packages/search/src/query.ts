import type { CardSearchDocument } from "./card-search-document";
import type { SearchIndex } from "./search-index";

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
  sort?: "relevance" | "price_asc" | "price_desc" | "popularity" | "newest";
};

export interface SearchOutcome {
  hits: CardSearchDocument[];
  page: number;
  pageSize: number;
  totalHits: number;
  totalPages: number;
  processingTimeMs: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// A bare "*" is Typesense's old match-all wildcard -- kept as an accepted
// spelling so existing callers (e.g. the recently-added feed) don't need to
// change how they ask for "everything".
function hasTextQuery(q: string | undefined): q is string {
  return typeof q === "string" && q.trim().length > 0 && q.trim() !== "*";
}

function matchesFilters(doc: CardSearchDocument, params: SearchQueryParams): boolean {
  if (params.set && doc.set_code !== params.set) return false;
  if (params.collectorNumber && doc.collector_number !== params.collectorNumber) return false;
  if (params.artist && doc.artist !== params.artist) return false;
  if (params.rarity && doc.rarity !== params.rarity) return false;
  if (params.finish && doc.finish !== params.finish) return false;
  if (params.condition && doc.condition !== params.condition) return false;

  if (params.colour && params.colour.length > 0) {
    if (!params.colour.some((colour) => doc.colour_identity.includes(colour))) return false;
  }

  if (params.format && doc.legality[params.format] !== "legal") return false;
  if (params.minPrice !== undefined && doc.price_amount < params.minPrice) return false;
  if (params.maxPrice !== undefined && doc.price_amount > params.maxPrice) return false;
  if (params.inStock && doc.quantity_available <= 0) return false;
  if (params.storeId && (doc.quantity_in_stores[params.storeId] ?? 0) <= 0) return false;

  return true;
}

function compareBySort(
  sort: SearchQueryParams["sort"],
  a: CardSearchDocument,
  b: CardSearchDocument,
): number {
  switch (sort) {
    case "price_asc":
      return a.price_amount - b.price_amount;
    case "price_desc":
      return b.price_amount - a.price_amount;
    case "newest":
      return b.catalogued_at - a.catalogued_at;
    case "popularity":
    default:
      return b.popularity_score - a.popularity_score;
  }
}

// Text query -> MiniSearch's own relevance ranking (prefix + light fuzzy
// matching on name/type_line/artist/set_name, filtered on every other
// param). No text query -> a plain scan over the in-memory document map,
// filtered and sorted the same way -- MiniSearch is a text-search engine,
// not a general "list everything" API, and at this document count
// (roughly 800k) a plain array filter/sort comfortably clears the same
// latency budget a database query would.
export function runSearch(index: SearchIndex, params: SearchQueryParams): SearchOutcome {
  const start = Date.now();
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(Math.max(1, params.limit ?? DEFAULT_LIMIT), MAX_LIMIT);

  let matched: CardSearchDocument[];
  let explicitSort = Boolean(params.sort) && params.sort !== "relevance";

  if (hasTextQuery(params.q)) {
    const results = index.mini.search(params.q, {
      prefix: true,
      fuzzy: 0.2,
      boost: { name: 2 },
      filter: (result) => matchesFilters(result as unknown as CardSearchDocument, params),
    });
    matched = results as unknown as CardSearchDocument[];
  } else {
    matched = Array.from(index.docsById.values()).filter((doc) => matchesFilters(doc, params));
    // No text query means MiniSearch's relevance ranking never applied in
    // the first place, so fall back to popularity -- same role Typesense's
    // default_sorting_field played.
    if (!explicitSort) explicitSort = true;
  }

  if (explicitSort) {
    matched = [...matched].sort((a, b) => compareBySort(params.sort, a, b));
  }

  const totalHits = matched.length;
  const offset = (page - 1) * limit;
  const hits = matched.slice(offset, offset + limit);

  return {
    hits,
    page,
    pageSize: limit,
    totalHits,
    totalPages: Math.max(1, Math.ceil(totalHits / limit)),
    processingTimeMs: Date.now() - start,
  };
}
