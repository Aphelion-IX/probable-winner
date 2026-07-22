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

export async function listSets(): Promise<SetSummary[]> {
  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("sets")
    .select("code, name, set_type, released_at, card_count")
    .order("released_at", { ascending: false, nullsFirst: false })
    .returns<SetRow[]>();

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
