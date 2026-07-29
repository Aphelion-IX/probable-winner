import { unstable_cache } from "next/cache";

import { createPublicSupabaseClient } from "@/server/supabase";
import { CARD_COLORS, CARD_FINISHES, onlyKnown } from "./list-cards";

// Set-detail table (the "set opened" page): one row per printing+finish,
// not one row per exact SKU -- a printing's conditions/languages all
// collapse into a single row showing the cheapest active price and the
// combined available quantity, matching how the reference layout the user
// asked to match shows exactly one row per finish (e.g. "Foo" and
// "Foo · Foil" as two rows, not one row per condition). representativeSkuId
// is the specific SKU that add-to-cart acts on for that row -- the
// cheapest in-stock condition, or just the cheapest if none are in stock.
export type SetCardRow = {
  printingId: string;
  name: string;
  typeLine: string;
  colors: string[];
  rarity: string;
  collectorNumber: string;
  finishCode: string;
  borderColor: string | null;
  representativeSkuId: string;
  price: number | null;
  currency: string | null;
  availableQuantity: number;
  imageUrl: string | null;
};

// The schema has no dedicated "full art"/frame-effects column -- border_color
// is the closest real attribute to a visual "treatment", with "borderless"
// standing in for full-art/showcase-style prints.
import { CARD_BORDER_COLORS } from "@/features/catalogue/lib/card-facets";

export { CARD_BORDER_COLORS, SET_CARD_SORTS } from "@/features/catalogue/lib/card-facets";
export type { CardBorderColor, SetCardSort } from "@/features/catalogue/lib/card-facets";

export type ListSetCardsOptions = {
  inStockOnly?: boolean;
  colors?: string[];
  finishes?: string[];
  borderColors?: string[];
  sort?: string;
};

// Large sets have thousands of printing+finish rows -- an HTML table that
// size is impractical to render and scroll, so cap the set-detail view at
// this many rows (sorted by name) rather than showing everything.
const MAX_RESULT_ROWS = 200;

type ListSetCardsRpcRow = {
  printing_id: string;
  name: string;
  type_line: string;
  colors: string[];
  rarity: string;
  collector_number: string;
  finish_code: string;
  border_color: string | null;
  representative_sku_id: string;
  price: number | null;
  currency: string | null;
  available_quantity: number;
  image_url: string | null;
};

// This used to page/chunk sellable_skus + card_images/published_prices/
// inventory_balances into 100-300+ sequential HTTP round trips for large
// sets (The List, Commander Masters, Doctor Who, ...), each individually
// fast but dominated end-to-end by round-trip latency. list_set_cards() (see
// supabase/migrations/20260728230342_list_set_cards_function.sql, since
// rewritten by 20260729061810_speed_up_list_set_cards.sql) does the same
// joins/grouping/filtering/sorting in one database call.
//
// That call runs as `anon`, which Supabase caps at a 3s statement_timeout,
// so it is a hard ceiling and not a target: large sets used to blow straight
// through it and render an error instead of a table. Measured as anon
// against production after the rewrite, the default in-stock view is 87ms
// for Commander Masters and 467ms for The List, and no set in the catalogue
// exceeds 500ms. See docs/performance.md's fourth trap before changing this
// query -- in particular, measure as `anon`, since a superuser measurement
// silently skips the RLS policies this path pays for on every row.
//
// That single round trip is still real per-request latency, and this result
// is identical for every visitor -- every table list_set_cards() reads
// (sets, card_printings, oracle_cards, sellable_skus, card_images) has an
// unconditional `using (true)` anon/authenticated read policy, and
// published_prices/inventory_balances' own public policies only check
// `status = 'active'`/the fulfilment node's `active` flag, never a session
// or customer id (confirmed against each policy's migration) -- so caching
// it is not a per-user shortcut, it's the same answer computed once. Same
// unstable_cache + cookie-free-client shape as get-card-identity.ts/
// list-active-stores.ts: revalidate on a short timer rather than wiring
// revalidateTag into every price/inventory mutation, since this is a
// browse-page read, not the authoritative price/stock check (that happens
// again, live, when a SKU is actually added to cart or checked out) -- up to
// REVALIDATE_SECONDS of staleness here can't affect a real transaction's
// correctness.
const REVALIDATE_SECONDS = 30;

export function listSetCardsCacheKey(setCode: string, options: ListSetCardsOptions): string[] {
  return [
    "list-set-cards",
    setCode,
    String(options.inStockOnly ?? false),
    onlyKnown(options.colors, CARD_COLORS).sort().join(","),
    onlyKnown(options.finishes, CARD_FINISHES).sort().join(","),
    onlyKnown(options.borderColors, CARD_BORDER_COLORS).sort().join(","),
    options.sort ?? "name-asc",
  ];
}

export function listSetCardsCacheTag(setCode: string): string {
  return `set-cards:${setCode}`;
}

async function fetchSetCards(setCode: string, options: ListSetCardsOptions): Promise<SetCardRow[]> {
  // Not createServerSupabaseClient(): this is wrapped in unstable_cache()
  // below, which forbids calling cookies() (which that client awaits) -- and
  // this data is identical for every viewer regardless of session (see the
  // RLS-policy reasoning above).
  const supabase = createPublicSupabaseClient();

  const finishFilter = onlyKnown(options.finishes, CARD_FINISHES);
  const colorFilter = onlyKnown(options.colors, CARD_COLORS);
  const borderColorFilter = onlyKnown(options.borderColors, CARD_BORDER_COLORS);

  const { data, error } = await supabase.rpc("list_set_cards", {
    p_set_code: setCode,
    p_in_stock_only: options.inStockOnly ?? false,
    p_colors: colorFilter,
    p_finishes: finishFilter,
    p_border_colors: borderColorFilter,
    p_sort: options.sort ?? "name-asc",
    p_limit: MAX_RESULT_ROWS,
  });

  if (error) {
    throw new Error(`Failed to list set cards: ${error.message}`);
  }

  const rows = (data ?? []) as ListSetCardsRpcRow[];

  return rows.map((row) => ({
    printingId: row.printing_id,
    name: row.name,
    typeLine: row.type_line,
    colors: row.colors,
    rarity: row.rarity,
    collectorNumber: row.collector_number,
    finishCode: row.finish_code,
    borderColor: row.border_color,
    representativeSkuId: row.representative_sku_id,
    price: row.price,
    currency: row.currency,
    availableQuantity: row.available_quantity,
    imageUrl: row.image_url,
  }));
}

export async function listSetCards(
  setCode: string,
  options: ListSetCardsOptions = {},
): Promise<SetCardRow[]> {
  const cached = unstable_cache(
    () => fetchSetCards(setCode, options),
    listSetCardsCacheKey(setCode, options),
    {
      revalidate: REVALIDATE_SECONDS,
      tags: [listSetCardsCacheTag(setCode)],
    },
  );

  return cached();
}
