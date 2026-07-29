import { unstable_cache } from "next/cache";

import { createPublicSupabaseClient } from "@/server/supabase";
import { sanitizeForIlike } from "@/features/catalogue/lib/postgrest-filters";

// sets is anon/authenticated-readable unconditionally (`using (true)`,
// 20260722113901_catalogue_rls.sql) -- the same rows for every visitor --
// so both queries below are cached with a short revalidate rather than
// fetched fresh on every request, same shape as get-card-identity.ts/
// list-set-cards.ts (cookie-free client required inside unstable_cache;
// staleness here can't affect a real transaction since checkout re-reads
// live data of its own).
const REVALIDATE_SECONDS = 60;

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

async function fetchSets(search: string | undefined): Promise<SetSummary[]> {
  // Not createServerSupabaseClient() -- see list-sets.ts's own top-of-file
  // comment: this is wrapped in unstable_cache() below.
  const supabase = createPublicSupabaseClient();

  let query = supabase
    .from("sets")
    .select("code, name, set_type, released_at, card_count, icon_url")
    .order("released_at", { ascending: false, nullsFirst: false });

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

export async function listSets(options: ListSetsOptions = {}): Promise<SetSummary[]> {
  const search = options.search?.trim();
  const cached = unstable_cache(() => fetchSets(search), ["list-sets", search ?? ""], {
    revalidate: REVALIDATE_SECONDS,
    tags: ["sets"],
  });

  return cached();
}

async function fetchSet(code: string): Promise<SetSummary | null> {
  const supabase = createPublicSupabaseClient();

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

// Single-set lookup for the set-detail ("set opened") page's header.
export async function getSet(code: string): Promise<SetSummary | null> {
  const cached = unstable_cache(() => fetchSet(code), ["get-set", code], {
    revalidate: REVALIDATE_SECONDS,
    tags: ["sets", `set:${code}`],
  });

  return cached();
}
