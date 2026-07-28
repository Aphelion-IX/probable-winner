import { createServerSupabaseClient } from "@/server/supabase";
import { sanitizeForIlike } from "@/features/catalogue/lib/postgrest-filters";

export type SetSummary = {
  code: string;
  name: string;
  setType: string | null;
  releasedAt: string | null;
  cardCount: number;
  iconUrl: string | null;
};

type SetRow = {
  code: string;
  name: string;
  set_type: string | null;
  released_at: string | null;
  card_count: number;
  icon_url: string | null;
};

export type ListSetsOptions = {
  search?: string;
};

// Simple ilike search over the small, slow-growing sets table (869 rows
// today) -- unlike card search, this never needed the search service:
// good enough for a handful of hundreds of sets, not meant to rank/facet.
export function buildSearchFilter(search: string): string {
  const escaped = sanitizeForIlike(search);
  return `name.ilike.%${escaped}%,code.ilike.%${escaped}%`;
}

export async function listSets(options: ListSetsOptions = {}): Promise<SetSummary[]> {
  const supabase = await createServerSupabaseClient();

  let query = supabase
    .from("sets")
    .select("code, name, set_type, released_at, card_count, icon_url")
    .order("released_at", { ascending: false, nullsFirst: false });

  const search = options.search?.trim();
  if (search) {
    query = query.or(buildSearchFilter(search));
  }

  const { data, error } = await query.returns<SetRow[]>();

  if (error) {
    throw new Error(`Failed to list sets: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    code: row.code,
    name: row.name,
    setType: row.set_type,
    releasedAt: row.released_at,
    cardCount: row.card_count,
    iconUrl: row.icon_url,
  }));
}

// Single-set lookup for the set-detail ("set opened") page's header.
export async function getSet(code: string): Promise<SetSummary | null> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("sets")
    .select("code, name, set_type, released_at, card_count, icon_url")
    .eq("code", code)
    .maybeSingle<SetRow>();

  if (error) {
    throw new Error(`Failed to fetch set: ${error.message}`);
  }
  if (!data) {
    return null;
  }

  return {
    code: data.code,
    name: data.name,
    setType: data.set_type,
    releasedAt: data.released_at,
    cardCount: data.card_count,
    iconUrl: data.icon_url,
  };
}
