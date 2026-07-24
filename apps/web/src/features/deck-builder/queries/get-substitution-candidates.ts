import { createServerSupabaseClient } from "@/server/supabase";
import type { SkuCandidate } from "@/features/deck-builder/lib/resolve-substitution";

// Batched candidate gathering for substitution (B-183): given the oracle
// card ids behind every resolved decklist line, this issues a small, fixed
// number of queries regardless of list length — never one per line, same
// principle as match-decklist-lines.ts (B-181, blueprint §20). Scoped to
// English/nonfoil only: substituting finish or language too is a much
// larger search space than "which condition/printing is affordable and in
// stock", and isn't asked for by this task's AC.

export type SubstitutionCandidate = SkuCandidate & {
  setCode: string;
  setName: string;
  collectorNumber: string;
};

type PrintingRow = {
  id: string;
  oracle_card_id: string;
  collector_number: string;
  sets: { code: string; name: string } | null;
};

type SkuRow = {
  id: string;
  card_printing_id: string;
  conditions: { code: string; sort_order: number } | null;
};

type PublishedPriceRow = {
  sellable_sku_id: string;
  final_amount: number;
};

type BalanceRow = {
  sellable_sku_id: string;
  quantity_available_online: number;
};

export async function getSubstitutionCandidatesByOracleCard(
  oracleCardIds: string[],
): Promise<Map<string, SubstitutionCandidate[]>> {
  const uniqueOracleCardIds = Array.from(new Set(oracleCardIds));

  if (uniqueOracleCardIds.length === 0) {
    return new Map();
  }

  const supabase = createServerSupabaseClient();

  const { data: printingRows, error: printingsError } = await supabase
    .from("card_printings")
    .select("id, oracle_card_id, collector_number, sets ( code, name )")
    .in("oracle_card_id", uniqueOracleCardIds)
    .returns<PrintingRow[]>();

  if (printingsError) {
    throw new Error(`Failed to load sibling printings: ${printingsError.message}`);
  }

  const printings = (printingRows ?? []).filter(
    (row): row is PrintingRow & { sets: { code: string; name: string } } => row.sets !== null,
  );
  const printingIds = printings.map((row) => row.id);

  if (printingIds.length === 0) {
    return new Map();
  }

  const { data: skuRows, error: skusError } = await supabase
    .from("sellable_skus")
    .select(
      "id, card_printing_id, conditions ( code, sort_order ), finishes!inner ( code ), languages!inner ( code ), product_statuses!inner ( code )",
    )
    .in("card_printing_id", printingIds)
    .eq("finishes.code", "nonfoil")
    .eq("languages.code", "en")
    .eq("product_statuses.code", "active")
    .returns<SkuRow[]>();

  if (skusError) {
    throw new Error(`Failed to load sellable SKUs: ${skusError.message}`);
  }

  const skus = (skuRows ?? []).filter(
    (row): row is SkuRow & { conditions: { code: string; sort_order: number } } =>
      row.conditions !== null,
  );
  const skuIds = skus.map((row) => row.id);

  if (skuIds.length === 0) {
    return new Map();
  }

  const [{ data: priceRows, error: priceError }, { data: balanceRows, error: balanceError }] =
    await Promise.all([
      supabase
        .from("published_prices")
        .select("sellable_sku_id, final_amount")
        .in("sellable_sku_id", skuIds)
        .eq("status", "active")
        .returns<PublishedPriceRow[]>(),
      supabase
        .from("inventory_balances")
        .select("sellable_sku_id, quantity_available_online")
        .in("sellable_sku_id", skuIds)
        .returns<BalanceRow[]>(),
    ]);

  if (priceError) {
    throw new Error(`Failed to load prices: ${priceError.message}`);
  }
  if (balanceError) {
    throw new Error(`Failed to load availability: ${balanceError.message}`);
  }

  const priceBySkuId = new Map(
    (priceRows ?? []).map((row) => [row.sellable_sku_id, row.final_amount]),
  );
  const availabilityBySkuId = new Map<string, number>();
  for (const row of balanceRows ?? []) {
    availabilityBySkuId.set(
      row.sellable_sku_id,
      (availabilityBySkuId.get(row.sellable_sku_id) ?? 0) + row.quantity_available_online,
    );
  }

  const printingById = new Map(printings.map((row) => [row.id, row]));

  const candidatesByOracleCard = new Map<string, SubstitutionCandidate[]>();

  for (const sku of skus) {
    const printing = printingById.get(sku.card_printing_id);
    const price = priceBySkuId.get(sku.id);
    if (!printing || price === undefined) {
      continue;
    }

    const candidate: SubstitutionCandidate = {
      skuId: sku.id,
      printingId: printing.id,
      conditionCode: sku.conditions.code,
      conditionSortOrder: sku.conditions.sort_order,
      price,
      availableQuantity: availabilityBySkuId.get(sku.id) ?? 0,
      setCode: printing.sets.code,
      setName: printing.sets.name,
      collectorNumber: printing.collector_number,
    };

    const existing = candidatesByOracleCard.get(printing.oracle_card_id);
    if (existing) {
      existing.push(candidate);
    } else {
      candidatesByOracleCard.set(printing.oracle_card_id, [candidate]);
    }
  }

  return candidatesByOracleCard;
}
