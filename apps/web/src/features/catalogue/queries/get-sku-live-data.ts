import { createServerSupabaseClient } from "@/server/supabase";

// Deliberately NOT wrapped in unstable_cache — price and available quantity
// are the "volatile" section of the product page (blueprint §14) and must
// be fetched fresh on every request, separately from the cached identity/SKU
// shell, so a single sale doesn't force-invalidate the whole cached page.
export type SkuLiveData = {
  skuId: string;
  price: number | null;
  currency: string | null;
  availableQuantity: number;
};

type GetSkuLiveDataRpcRow = {
  sku_id: string;
  price: number | null;
  currency: string | null;
  available_quantity: number;
};

// This used to be 3 concurrent (Promise.all) PostgREST requests -- already
// not the sequential round-trip amplification bug fixed for
// list_set_cards()/list_popular_cards(), since none of the 3 queries
// depended on another's result, but still 3 separate HTTP round trips for
// what is the single highest-frequency catalogue query in the app: this
// backs apps/web/src/app/api/sellable-skus/[id]/route.ts, called on every
// product page view and every condition/finish switch a shopper makes.
// get_sku_live_data() (see
// supabase/migrations/20260729043229_get_sku_live_data_function.sql) does
// the same 3 lookups in one call -- each was already sub-millisecond and
// properly indexed on its own (confirmed via EXPLAIN ANALYZE against
// production), so the win here is purely fewer round trips, not query time.
export async function getSkuLiveData(skuId: string): Promise<SkuLiveData | null> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase.rpc("get_sku_live_data", { p_sku_id: skuId });

  if (error) {
    throw new Error(`Failed to look up SKU: ${error.message}`);
  }

  const rows = (data ?? []) as GetSkuLiveDataRpcRow[];
  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    skuId: row.sku_id,
    price: row.price,
    currency: row.currency,
    availableQuantity: row.available_quantity,
  };
}
