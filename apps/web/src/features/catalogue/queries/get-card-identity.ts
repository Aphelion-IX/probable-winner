import { unstable_cache } from "next/cache";

import { createServerSupabaseClient } from "@/server/supabase";

// Card identity data (blueprint §14 "stable section") changes only when the
// catalogue importer runs (backlog Step 5) — infrequent — so it's safe to
// cache aggressively rather than re-querying on every page view.
const CARD_IDENTITY_REVALIDATE_SECONDS = 3600;

const IMAGE_TYPE_PREFERENCE = ["normal", "large", "small", "png", "art_crop", "border_crop"];

export function cardIdentityCacheKey(printingId: string): string[] {
  return ["card-identity", printingId];
}

export function cardIdentityCacheTag(printingId: string): string {
  return `card-identity:${printingId}`;
}

export function pickImageUrl(images: { imageType: string; url: string }[]): string | null {
  for (const type of IMAGE_TYPE_PREFERENCE) {
    const match = images.find((image) => image.imageType === type);
    if (match) return match.url;
  }
  return images[0]?.url ?? null;
}

export type CardLegality = {
  formatCode: string;
  formatName: string;
  status: string;
};

export type RelatedPrinting = {
  printingId: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  rarity: string;
  releasedAt: string | null;
};

export type CardIdentity = {
  printingId: string;
  oracleCardId: string;
  name: string;
  manaCost: string | null;
  cmc: number | null;
  typeLine: string;
  oracleText: string | null;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  colors: string[];
  colorIdentity: string[];
  collectorNumber: string;
  rarity: string;
  flavorText: string | null;
  releasedAt: string | null;
  setCode: string;
  setName: string;
  artistName: string | null;
  imageUrl: string | null;
  legalities: CardLegality[];
  relatedPrintings: RelatedPrinting[];
};

type PrintingRow = {
  id: string;
  oracle_card_id: string;
  collector_number: string;
  rarity: string;
  flavor_text: string | null;
  released_at: string | null;
  oracle_cards: {
    name: string;
    mana_cost: string | null;
    cmc: number | null;
    type_line: string;
    oracle_text: string | null;
    power: string | null;
    toughness: string | null;
    loyalty: string | null;
    colors: string[];
    color_identity: string[];
  } | null;
  sets: { code: string; name: string } | null;
  artists: { name: string } | null;
  card_images: { image_type: string; url: string }[] | null;
};

type LegalityRow = {
  status: string;
  formats: { code: string; name: string } | null;
};

type RelatedPrintingRow = {
  id: string;
  collector_number: string;
  rarity: string;
  released_at: string | null;
  sets: { code: string; name: string } | null;
};

async function fetchCardIdentity(printingId: string): Promise<CardIdentity | null> {
  const supabase = createServerSupabaseClient();

  const { data: printing, error: printingError } = await supabase
    .from("card_printings")
    .select(
      `
      id,
      oracle_card_id,
      collector_number,
      rarity,
      flavor_text,
      released_at,
      oracle_cards ( name, mana_cost, cmc, type_line, oracle_text, power, toughness, loyalty, colors, color_identity ),
      sets ( code, name ),
      artists ( name ),
      card_images ( image_type, url )
    `,
    )
    .eq("id", printingId)
    .maybeSingle<PrintingRow>();

  if (printingError) {
    throw new Error(`Failed to load card identity: ${printingError.message}`);
  }

  if (!printing || !printing.oracle_cards || !printing.sets) {
    return null;
  }

  const [
    { data: legalityRows, error: legalitiesError },
    { data: relatedRows, error: relatedError },
  ] = await Promise.all([
    supabase
      .from("card_legalities")
      .select("status, formats ( code, name )")
      .eq("oracle_card_id", printing.oracle_card_id)
      .returns<LegalityRow[]>(),
    supabase
      .from("card_printings")
      .select("id, collector_number, rarity, released_at, sets ( code, name )")
      .eq("oracle_card_id", printing.oracle_card_id)
      .neq("id", printingId)
      .order("released_at", { ascending: false, nullsFirst: false })
      .returns<RelatedPrintingRow[]>(),
  ]);

  if (legalitiesError) {
    throw new Error(`Failed to load card legalities: ${legalitiesError.message}`);
  }
  if (relatedError) {
    throw new Error(`Failed to load related printings: ${relatedError.message}`);
  }

  return {
    printingId: printing.id,
    oracleCardId: printing.oracle_card_id,
    name: printing.oracle_cards.name,
    manaCost: printing.oracle_cards.mana_cost,
    cmc: printing.oracle_cards.cmc,
    typeLine: printing.oracle_cards.type_line,
    oracleText: printing.oracle_cards.oracle_text,
    power: printing.oracle_cards.power,
    toughness: printing.oracle_cards.toughness,
    loyalty: printing.oracle_cards.loyalty,
    colors: printing.oracle_cards.colors,
    colorIdentity: printing.oracle_cards.color_identity,
    collectorNumber: printing.collector_number,
    rarity: printing.rarity,
    flavorText: printing.flavor_text,
    releasedAt: printing.released_at,
    setCode: printing.sets.code,
    setName: printing.sets.name,
    artistName: printing.artists?.name ?? null,
    imageUrl: pickImageUrl(
      (printing.card_images ?? []).map((image) => ({
        imageType: image.image_type,
        url: image.url,
      })),
    ),
    legalities: (legalityRows ?? [])
      .filter(
        (row): row is LegalityRow & { formats: { code: string; name: string } } =>
          row.formats !== null,
      )
      .map((row) => ({
        formatCode: row.formats.code,
        formatName: row.formats.name,
        status: row.status,
      })),
    relatedPrintings: (relatedRows ?? [])
      .filter(
        (row): row is RelatedPrintingRow & { sets: { code: string; name: string } } =>
          row.sets !== null,
      )
      .map((row) => ({
        printingId: row.id,
        setCode: row.sets.code,
        setName: row.sets.name,
        collectorNumber: row.collector_number,
        rarity: row.rarity,
        releasedAt: row.released_at,
      })),
  };
}

export async function getCardIdentity(printingId: string): Promise<CardIdentity | null> {
  const cached = unstable_cache(
    () => fetchCardIdentity(printingId),
    cardIdentityCacheKey(printingId),
    {
      revalidate: CARD_IDENTITY_REVALIDATE_SECONDS,
      tags: [cardIdentityCacheTag(printingId)],
    },
  );

  return cached();
}
