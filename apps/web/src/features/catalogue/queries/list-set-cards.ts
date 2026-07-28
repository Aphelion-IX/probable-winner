import { createServerSupabaseClient } from "@/server/supabase";
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
// supabase/migrations/20260728230342_list_set_cards_function.sql) does the
// same joins/grouping/filtering/sorting in one database call -- 108ms for
// Commander Masters, 306ms for The List, measured directly against
// production.
export async function listSetCards(
  setCode: string,
  options: ListSetCardsOptions = {},
): Promise<SetCardRow[]> {
  const supabase = await createServerSupabaseClient();

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
