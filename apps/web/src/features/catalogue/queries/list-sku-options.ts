import { unstable_cache } from "next/cache";

import { createServerSupabaseClient } from "@/server/supabase";

// Which SKUs exist for a printing (backlog Step 6, B-050/B-051) only changes
// when the catalogue/SKU-generation jobs run, so — like get-card-identity.ts
// — it's safe to cache aggressively. Unlike price/availability (B-102's
// "volatile" fields, blueprint §14), this list itself is stable metadata.
const SKU_OPTIONS_REVALIDATE_SECONDS = 3600;

export function skuOptionsCacheKey(printingId: string): string[] {
  return ["sku-options", printingId];
}

export function skuOptionsCacheTag(printingId: string): string {
  return `sku-options:${printingId}`;
}

export type SkuOption = {
  skuId: string;
  languageCode: string;
  languageName: string;
  finishCode: string;
  finishName: string;
  conditionCode: string;
  conditionName: string;
  conditionSortOrder: number;
};

type SkuOptionRow = {
  id: string;
  languages: { code: string; name: string } | null;
  finishes: { code: string; name: string } | null;
  conditions: { code: string; name: string; sort_order: number } | null;
  product_statuses: { code: string } | null;
};

async function fetchSkuOptions(printingId: string): Promise<SkuOption[]> {
  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("sellable_skus")
    .select(
      "id, languages ( code, name ), finishes ( code, name ), conditions ( code, name, sort_order ), product_statuses ( code )",
    )
    .eq("card_printing_id", printingId)
    .returns<SkuOptionRow[]>();

  if (error) {
    throw new Error(`Failed to list SKU options: ${error.message}`);
  }

  return (data ?? [])
    .filter(
      (
        row,
      ): row is SkuOptionRow & {
        languages: { code: string; name: string };
        finishes: { code: string; name: string };
        conditions: { code: string; name: string; sort_order: number };
        product_statuses: { code: string };
      } =>
        row.languages !== null &&
        row.finishes !== null &&
        row.conditions !== null &&
        row.product_statuses?.code === "active",
    )
    .map((row) => ({
      skuId: row.id,
      languageCode: row.languages.code,
      languageName: row.languages.name,
      finishCode: row.finishes.code,
      finishName: row.finishes.name,
      conditionCode: row.conditions.code,
      conditionName: row.conditions.name,
      conditionSortOrder: row.conditions.sort_order,
    }))
    .sort(
      (a, b) =>
        a.conditionSortOrder - b.conditionSortOrder ||
        a.languageName.localeCompare(b.languageName) ||
        a.finishName.localeCompare(b.finishName),
    );
}

export async function listSkuOptions(printingId: string): Promise<SkuOption[]> {
  const cached = unstable_cache(() => fetchSkuOptions(printingId), skuOptionsCacheKey(printingId), {
    revalidate: SKU_OPTIONS_REVALIDATE_SECONDS,
    tags: [skuOptionsCacheTag(printingId)],
  });

  return cached();
}
