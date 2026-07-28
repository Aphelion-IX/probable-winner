// Homepage-adjacent "recently added" feed (backlog B-193, blueprint §20):
// surfaces newly catalogued/received cards via the search service, sorted by
// catalogued_at (card_printings.created_at), never a live Postgres scan per
// request. The search index has no group-by, and a printing can have
// several SKU documents (one per condition/finish/language) sharing the
// same catalogued_at, so this over-fetches and dedupes by oracle_id in
// memory rather than showing near-duplicate tiles.
import { queryLocalSearchIndex } from "@/lib/search-index-cache";

export interface RecentlyAddedCard {
  printingId: string;
  name: string;
  setCode: string;
  rarity: string;
  condition: string;
  finish: string;
  price: number;
}

const OVER_FETCH_FACTOR = 4;

export async function listRecentlyAddedCards(limit = 12): Promise<RecentlyAddedCard[]> {
  const outcome = await queryLocalSearchIndex({
    q: "*",
    inStock: true,
    sort: "newest",
    limit: limit * OVER_FETCH_FACTOR,
  });

  const seenOracleIds = new Set<string>();
  const cards: RecentlyAddedCard[] = [];

  for (const doc of outcome.hits) {
    if (seenOracleIds.has(doc.oracle_id)) continue;
    seenOracleIds.add(doc.oracle_id);

    cards.push({
      printingId: doc.printing_id,
      name: doc.name,
      setCode: doc.set_code,
      rarity: doc.rarity,
      condition: doc.condition,
      finish: doc.finish,
      price: doc.price_amount,
    });

    if (cards.length >= limit) break;
  }

  return cards;
}
