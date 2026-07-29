import { unstable_cache } from "next/cache";

import { createPublicSupabaseClient } from "@/server/supabase";
import type { CardBrowseItem } from "@/features/catalogue/queries/list-cards";

// Homepage "Popular right now" rail. Real popularity scoring (backlog
// B-085) isn't wired into card_browse yet, so this orders by newest
// printing as a stand-in — same fallback listCards() already uses for its
// "newest" sort. Unlike listCards()/the /cards page, this also resolves a
// price per printing (its first active published price, since the
// homepage rail is meant to show at-a-glance pricing).
export type PopularCardItem = CardBrowseItem & {
  price: number | null;
};

// card_browse/sellable_skus/published_prices are each anon/authenticated-
// readable unconditionally or on a status check only (never a session/
// customer id -- see list-set-cards.ts's own comment on the same tables),
// and this homepage rail is the same for every visitor, so it's worth
// caching -- three round trips (card_browse -> sellable_skus ->
// published_prices) on every homepage load otherwise. Same shape as
// get-card-identity.ts/list-set-cards.ts: time-based revalidation, not
// tag-based invalidation, since this is a browse-page read and checkout
// re-reads live prices of its own.
const REVALIDATE_SECONDS = 60;

type ListPopularCardsRpcRow = {
  printing_id: string;
  oracle_card_id: string;
  name: string;
  type_line: string;
  colors: string[];
  color_identity: string[];
  collector_number: string;
  rarity: string;
  finishes: string[];
  released_at: string | null;
  set_code: string;
  set_name: string;
  set_icon_url: string | null;
  image_url: string | null;
  price: number | null;
};

// This used to be 3 sequential round trips (card_browse -> sellable_skus ->
// published_prices), each individually cheap at this scale (limit 6) but
// still separate hops. list_popular_cards() (see
// supabase/migrations/20260729035510_list_popular_cards_function.sql) does
// the same lookup in one call. The bigger win measured there wasn't the
// round-trip count, though -- it was a missing index: card_browse's `order
// by released_at desc limit 6` forced a full sequential scan and sort of
// every card_printings row (143.6ms). The migration also adds
// card_printings_released_at_idx, which took the identical query to 2.6ms.
async function fetchPopularCards(limit: number): Promise<PopularCardItem[]> {
  // Not createServerSupabaseClient(): wrapped in unstable_cache() below,
  // which forbids calling cookies() -- and this rail is identical for every
  // visitor regardless of session.
  const supabase = createPublicSupabaseClient();

  const { data, error } = await supabase.rpc("list_popular_cards", { p_limit: limit });

  if (error) {
    throw new Error(`Failed to list popular cards: ${error.message}`);
  }

  const rows = (data ?? []) as ListPopularCardsRpcRow[];

  return rows.map((row) => ({
    printingId: row.printing_id,
    oracleCardId: row.oracle_card_id,
    name: row.name,
    typeLine: row.type_line,
    colors: row.colors,
    colorIdentity: row.color_identity,
    collectorNumber: row.collector_number,
    rarity: row.rarity,
    finishes: row.finishes,
    releasedAt: row.released_at,
    setCode: row.set_code,
    setName: row.set_name,
    setIconUrl: row.set_icon_url,
    imageUrl: row.image_url,
    price: row.price,
  }));
}

export async function listPopularCards(limit = 6): Promise<PopularCardItem[]> {
  const cached = unstable_cache(
    () => fetchPopularCards(limit),
    ["list-popular-cards", String(limit)],
    {
      revalidate: REVALIDATE_SECONDS,
      tags: ["popular-cards"],
    },
  );

  return cached();
}
