import { createServerSupabaseClient } from "@/server/supabase";
import { sanitizeForIlike } from "@/features/catalogue/lib/postgrest-filters";
import {
  CARD_COLORS,
  CARD_TYPES,
  CARD_RARITIES,
  CARD_FINISHES,
} from "@/features/catalogue/lib/card-facets";
import type { CardColor, CardType } from "@/features/catalogue/lib/card-facets";

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

export type ListCardsFilters = {
  sets?: string[];
  rarities?: string[];
  finishes?: string[];
  colors?: string[];
  types?: string[];
  sort?: string;
};

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

type CardBrowseRow = {
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
};

export function onlyKnown<T extends string>(
  values: string[] | undefined,
  known: readonly T[],
): T[] {
  if (!values) return [];
  return values.filter((value): value is T => (known as readonly string[]).includes(value));
}

// Builds one .or() expression combining chromatic colour overlap with an
// exact-match on the empty array for colourless ("C") — colourless cards
// have no real "colour", so it can't be expressed as an overlap.
export function buildColorFilter(colors: CardColor[]): string | null {
  const parts: string[] = [];
  const chromatic = colors.filter((color) => color !== "C");

  if (chromatic.length > 0) {
    parts.push(`colors.ov.{${chromatic.join(",")}}`);
  }
  if (colors.includes("C")) {
    parts.push("colors.eq.{}");
  }

  return parts.length > 0 ? parts.join(",") : null;
}

export function buildTypeFilter(types: CardType[]): string | null {
  if (types.length === 0) return null;
  return types.map((type) => `type_line.ilike.%${sanitizeForIlike(type)}%`).join(",");
}

export async function listCards(filters: ListCardsFilters = {}): Promise<CardBrowseItem[]> {
  const supabase = await createServerSupabaseClient();

  let query = supabase.from("card_browse").select("*");

  if (filters.sets && filters.sets.length > 0) {
    query = query.in("set_code", filters.sets);
  }

  const rarities = onlyKnown(filters.rarities, CARD_RARITIES);
  if (rarities.length > 0) {
    query = query.in("rarity", rarities);
  }

  const finishes = onlyKnown(filters.finishes, CARD_FINISHES);
  if (finishes.length > 0) {
    query = query.overlaps("finishes", finishes);
  }

  const colors = onlyKnown(filters.colors, CARD_COLORS);
  const colorFilter = buildColorFilter(colors);
  if (colorFilter) {
    query = query.or(colorFilter);
  }

  const types = onlyKnown(filters.types, CARD_TYPES);
  const typeFilter = buildTypeFilter(types);
  if (typeFilter) {
    query = query.or(typeFilter);
  }

  switch (filters.sort) {
    case "name-desc":
      query = query.order("name", { ascending: false });
      break;
    case "oldest":
      query = query.order("released_at", { ascending: true, nullsFirst: true });
      break;
    case "rarity":
      query = query.order("rarity", { ascending: true }).order("name", { ascending: true });
      break;
    case "newest":
      query = query.order("released_at", { ascending: false, nullsFirst: false });
      break;
    case "name-asc":
    default:
      query = query.order("name", { ascending: true });
      break;
  }

  const { data, error } = await query.returns<CardBrowseRow[]>();

  if (error) {
    throw new Error(`Failed to list cards: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
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
  }));
}
