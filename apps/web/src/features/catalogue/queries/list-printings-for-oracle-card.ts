import { unstable_cache } from "next/cache";

import { createServerSupabaseClient } from "@/server/supabase";
import {
  pickImageUrl,
  THUMBNAIL_IMAGE_TYPE_PREFERENCE,
} from "@/features/catalogue/queries/get-card-identity";

// Same rationale as get-card-identity.ts: printings only change on catalogue
// import runs, so this is safe to cache aggressively (blueprint §14).
const PRINTINGS_REVALIDATE_SECONDS = 3600;

export function printingsForOracleCardCacheKey(oracleCardId: string): string[] {
  return ["printings-for-oracle-card", oracleCardId];
}

export function printingsForOracleCardCacheTag(oracleCardId: string): string {
  return `printings-for-oracle-card:${oracleCardId}`;
}

export type PrintingSummary = {
  printingId: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  rarity: string;
  releasedAt: string | null;
  finishes: string[];
  thumbnailUrl: string | null;
};

type PrintingSummaryRow = {
  id: string;
  collector_number: string;
  rarity: string;
  released_at: string | null;
  finishes: string[];
  sets: { code: string; name: string } | null;
  card_images: { image_type: string; url: string }[] | null;
};

async function fetchPrintingsForOracleCard(oracleCardId: string): Promise<PrintingSummary[]> {
  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("card_printings")
    .select(
      "id, collector_number, rarity, released_at, finishes, sets ( code, name ), card_images ( image_type, url )",
    )
    .eq("oracle_card_id", oracleCardId)
    .order("released_at", { ascending: false, nullsFirst: false })
    .returns<PrintingSummaryRow[]>();

  if (error) {
    throw new Error(`Failed to list printings: ${error.message}`);
  }

  return (data ?? [])
    .filter(
      (row): row is PrintingSummaryRow & { sets: { code: string; name: string } } =>
        row.sets !== null,
    )
    .map((row) => ({
      printingId: row.id,
      setCode: row.sets.code,
      setName: row.sets.name,
      collectorNumber: row.collector_number,
      rarity: row.rarity,
      releasedAt: row.released_at,
      finishes: row.finishes,
      thumbnailUrl: pickImageUrl(
        (row.card_images ?? []).map((image) => ({ imageType: image.image_type, url: image.url })),
        THUMBNAIL_IMAGE_TYPE_PREFERENCE,
      ),
    }));
}

export async function listPrintingsForOracleCard(oracleCardId: string): Promise<PrintingSummary[]> {
  const cached = unstable_cache(
    () => fetchPrintingsForOracleCard(oracleCardId),
    printingsForOracleCardCacheKey(oracleCardId),
    {
      revalidate: PRINTINGS_REVALIDATE_SECONDS,
      tags: [printingsForOracleCardCacheTag(oracleCardId)],
    },
  );

  return cached();
}
