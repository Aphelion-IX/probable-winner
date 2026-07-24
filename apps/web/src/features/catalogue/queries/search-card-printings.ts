import { createServerSupabaseClient } from "@/server/supabase";
import { sanitizeForIlike } from "@/features/catalogue/lib/postgrest-filters";

// A small, direct-to-Postgres name search for the alert-creation form
// (backlog B-191): low-traffic, a handful of results, not the storefront's
// hot search path -- unlike the main search box, which must go through
// Typesense per blueprint §20 ("don't query Postgres on every search
// keystroke").
const SEARCH_LIMIT = 8;

export type CardPrintingSearchResult = {
  printingId: string;
  name: string;
  setCode: string;
  setName: string;
};

type CardPrintingRow = {
  printing_id: string;
  name: string;
  set_code: string;
  set_name: string;
};

export async function searchCardPrintings(query: string): Promise<CardPrintingSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("card_browse")
    .select("printing_id, name, set_code, set_name")
    .ilike("name", `%${sanitizeForIlike(trimmed)}%`)
    .order("name", { ascending: true })
    .limit(SEARCH_LIMIT)
    .returns<CardPrintingRow[]>();

  if (error) {
    throw new Error(`Failed to search card printings: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    printingId: row.printing_id,
    name: row.name,
    setCode: row.set_code,
    setName: row.set_name,
  }));
}
