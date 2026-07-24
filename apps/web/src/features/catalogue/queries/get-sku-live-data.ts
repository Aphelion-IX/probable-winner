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

type PublishedPriceRow = {
  final_amount: number;
  currency: string;
};

export async function getSkuLiveData(skuId: string): Promise<SkuLiveData | null> {
  const supabase = createServerSupabaseClient();

  const [
    { data: sku, error: skuError },
    { data: priceRow, error: priceError },
    { data: balances, error: balanceError },
  ] = await Promise.all([
    supabase.from("sellable_skus").select("id").eq("id", skuId).maybeSingle(),
    supabase
      .from("published_prices")
      .select("final_amount, currency")
      .eq("sellable_sku_id", skuId)
      .eq("status", "active")
      .maybeSingle<PublishedPriceRow>(),
    supabase
      .from("inventory_balances")
      .select("quantity_available_online")
      .eq("sellable_sku_id", skuId),
  ]);

  if (skuError) {
    throw new Error(`Failed to look up SKU: ${skuError.message}`);
  }
  if (!sku) {
    return null;
  }
  if (priceError) {
    throw new Error(`Failed to look up price: ${priceError.message}`);
  }
  if (balanceError) {
    throw new Error(`Failed to look up availability: ${balanceError.message}`);
  }

  const availableQuantity = (balances ?? []).reduce(
    (total, row) => total + (row.quantity_available_online ?? 0),
    0,
  );

  return {
    skuId,
    price: priceRow?.final_amount ?? null,
    currency: priceRow?.currency ?? null,
    availableQuantity,
  };
}
