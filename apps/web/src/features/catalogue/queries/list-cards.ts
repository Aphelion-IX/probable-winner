// This module used to also hold listCards(), the query behind the
// browse-all-printings page. That page was removed (superseded by
// /search's search-service-backed filtering + pagination and /sets'
// browse-by-set flow) but the facet constants/helpers below are still
// shared by list-set-cards.ts (the /sets/[code] table) and
// list-popular-cards.ts (the homepage rail), so this file stays.

// Facet values live in lib/card-facets so the client-side filter bars can
// import them without dragging the server-only Supabase client (and
// next/headers) into the browser bundle. Re-exported here so existing
// server-side imports of this module are unaffected.
export {
  CARD_COLORS,
  CARD_TYPES,
  CARD_RARITIES,
  CARD_FINISHES,
  CARD_SORTS,
} from "@/features/catalogue/lib/card-facets";
export type {
  CardColor,
  CardType,
  CardRarity,
  CardFinish,
  CardSort,
} from "@/features/catalogue/lib/card-facets";

export type CardBrowseItem = {
  printingId: string;
  oracleCardId: string;
  name: string;
  typeLine: string;
  colors: string[];
  colorIdentity: string[];
  collectorNumber: string;
  rarity: string;
  finishes: string[];
  releasedAt: string | null;
  setCode: string;
  setName: string;
  setIconUrl: string | null;
  imageUrl: string | null;
};

export function onlyKnown<T extends string>(
  values: string[] | undefined,
  known: readonly T[],
): T[] {
  if (!values) return [];
  return values.filter((value): value is T => (known as readonly string[]).includes(value));
}
