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

// Simple ilike search — a skeleton ahead of Typesense-backed search
// (backlog Step 9). Good enough for a handful of sets; not meant to survive
// once the catalogue is fully imported and search needs to rank/facet.
export function buildSearchFilter(search: string): string {
  const escaped = sanitizeForIlike(search);
  return `name.ilike.%${escaped}%,code.ilike.%${escaped}%`;
}

export async function listSets(options: ListSetsOptions = {}): Promise<SetSummary[]> {
  const supabase = createServerSupabaseClient();

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
