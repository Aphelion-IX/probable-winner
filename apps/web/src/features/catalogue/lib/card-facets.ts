/**
 * Card browse facet values, shared by the filter UI and the query layer.
 *
 * These live apart from `queries/list-cards.ts` because the filter bars are
 * client components: importing a value (not just a type) from the query
 * module pulls the whole module — and therefore the server-only Supabase
 * client, which imports `next/headers` — into the browser bundle, which does
 * not build.
 *
 * `list-cards.ts` re-exports everything here, so existing server-side imports
 * keep working unchanged.
 */

export const CARD_COLORS = ["W", "U", "B", "R", "G", "C"] as const;
export type CardColor = (typeof CARD_COLORS)[number];

export const CARD_TYPES = [
  "Artifact",
  "Battle",
  "Creature",
  "Enchantment",
  "Instant",
  "Land",
  "Planeswalker",
  "Sorcery",
  "Kindred",
] as const;
export type CardType = (typeof CARD_TYPES)[number];

export const CARD_RARITIES = ["common", "uncommon", "rare", "mythic", "special", "bonus"] as const;
export type CardRarity = (typeof CARD_RARITIES)[number];

export const CARD_FINISHES = ["nonfoil", "foil", "etched"] as const;
export type CardFinish = (typeof CARD_FINISHES)[number];

export const CARD_SORTS = ["name-asc", "name-desc", "newest", "oldest", "rarity"] as const;
export type CardSort = (typeof CARD_SORTS)[number];

// Set-detail facets. Same reasoning as above: the set filter bar is a client
// component, so these cannot live in queries/list-set-cards.ts.
//
// Magic has no "card treatment" column; border_color is the closest real
// attribute to a visual treatment, with "borderless" standing in for
// full-art/showcase-style prints.
export const CARD_BORDER_COLORS = [
  "black",
  "white",
  "borderless",
  "gold",
  "silver",
  "yellow",
] as const;
export type CardBorderColor = (typeof CARD_BORDER_COLORS)[number];

export const SET_CARD_SORTS = ["name-asc", "price-desc", "price-asc"] as const;
export type SetCardSort = (typeof SET_CARD_SORTS)[number];
