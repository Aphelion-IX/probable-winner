// Shared search query used by both the /api/search route handler (for
// client-side fetches, e.g. header search-as-you-type) and the /search page's
// server component. The server component must call this directly rather than
// fetching its own API route: an RSC doing `fetch("http://localhost:3000/...")`
// has no server to reach on Vercel (each request runs in an isolated
// serverless function, not a persistent localhost listener), so a self-fetch
// fails in production even though the same query works fine hit directly.
import { type SearchQueryParams } from "@probable-winner/search";

import { queryLocalSearchIndex } from "@/lib/search-index-cache";

export interface SearchCardsResult {
  hits: {
    id: string;
    // The card identity page routes by card_printings id, not the sku id
    // above -- distinct fields in the search document for exactly this
    // reason (see @probable-winner/search's card-search-document.ts comment
    // on printing_id).
    printingId: string;
    name: string;
    set: string;
    rarity: string;
    artist: string;
    condition: string;
    finish: string;
    price: number;
    imageUrl: string | null;
  }[];
  page: number;
  pageSize: number;
  totalHits: number;
  totalPages: number;
  processingTimeMs: number;
}

export async function searchCards(params: SearchQueryParams): Promise<SearchCardsResult> {
  const outcome = await queryLocalSearchIndex(params);

  const hits = outcome.hits.map((doc) => ({
    id: doc.id,
    printingId: doc.printing_id,
    name: doc.name,
    set: doc.set_code,
    rarity: doc.rarity,
    artist: doc.artist,
    condition: doc.condition,
    finish: doc.finish,
    price: doc.price_amount,
    imageUrl: doc.image_url || null,
  }));

  return {
    hits,
    page: outcome.page,
    pageSize: outcome.pageSize,
    totalHits: outcome.totalHits,
    totalPages: outcome.totalPages,
    processingTimeMs: outcome.processingTimeMs,
  };
}
