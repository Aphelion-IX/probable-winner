import { unstable_cache } from "next/cache";

import { createServerSupabaseClient } from "@/server/supabase";

// Format list changes only when a new format is added to the game (rare),
// so this is safe to cache like list-active-stores.ts.
const FORMATS_REVALIDATE_SECONDS = 3600;
const FORMATS_CACHE_KEY = ["storefront-formats"];
const FORMATS_CACHE_TAG = "storefront-formats";

export type StorefrontFormat = {
  code: string;
  name: string;
};

type FormatRow = {
  code: string;
  name: string;
};

// Featured formats for the homepage's "Shop by format" rail, in the order
// players actually look for them -- not every seeded format (Old School,
// Penny Dreadful, etc. are real but niche; /search?format= still supports
// them, they're just not worth a homepage tile).
const FEATURED_FORMAT_CODES = [
  "commander",
  "modern",
  "standard",
  "pioneer",
  "legacy",
  "vintage",
  "pauper",
];

async function fetchFormats(): Promise<StorefrontFormat[]> {
  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("formats")
    .select("code, name, games!inner(code)")
    .eq("games.code", "mtg")
    .returns<(FormatRow & { games: { code: string } })[]>();

  if (error) {
    throw new Error(`Failed to list formats: ${error.message}`);
  }

  return (data ?? []).map(({ code, name }) => ({ code, name }));
}

export async function listFeaturedFormats(): Promise<StorefrontFormat[]> {
  const cached = unstable_cache(fetchFormats, FORMATS_CACHE_KEY, {
    revalidate: FORMATS_REVALIDATE_SECONDS,
    tags: [FORMATS_CACHE_TAG],
  });

  const formats = await cached();
  const byCode = new Map(formats.map((format) => [format.code, format]));

  return FEATURED_FORMAT_CODES.map((code) => byCode.get(code)).filter(
    (format): format is StorefrontFormat => format != null,
  );
}
