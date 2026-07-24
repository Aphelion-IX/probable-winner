import { createServerSupabaseClient } from "@/server/supabase";
import { sanitizeForIlike } from "@/features/catalogue/lib/postgrest-filters";

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
  const supabase = createServerSupabaseClient();

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
    imageUrl: row.image_url,
  }));
}
