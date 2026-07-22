import { createServerSupabaseClient } from "@/server/supabase";

export type SetSummary = {
  code: string;
  name: string;
  setType: string | null;
  releasedAt: string | null;
  cardCount: number;
};

type SetRow = {
  code: string;
  name: string;
  set_type: string | null;
  released_at: string | null;
  card_count: number;
};

export type ListSetsOptions = {
  search?: string;
};

// Simple ilike search — a skeleton ahead of Typesense-backed search
// (backlog Step 9). Good enough for a handful of sets; not meant to survive
// once the catalogue is fully imported and search needs to rank/facet.
export function buildSearchFilter(search: string): string {
  const withoutFilterSyntax = search.replace(/[,()]/g, "").trim();
  const escaped = withoutFilterSyntax.replace(/[%_\\]/g, (match) => `\\${match}`);
  return `name.ilike.%${escaped}%,code.ilike.%${escaped}%`;
}

export async function listSets(options: ListSetsOptions = {}): Promise<SetSummary[]> {
  const supabase = createServerSupabaseClient();

  let query = supabase
    .from("sets")
    .select("code, name, set_type, released_at, card_count")
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
  }));
}
