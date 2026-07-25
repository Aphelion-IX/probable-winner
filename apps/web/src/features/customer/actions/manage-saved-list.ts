"use server";

import { createServerSupabaseClient } from "@/server/supabase";
import { logger, getRequestId } from "@/lib/logger";

export interface SavedListItem {
  sellableSkuId: string;
  printingId: string;
  cardName: string;
  setCode: string;
  rarity: string;
  conditionCode: string;
  finishCode: string;
  price: number | null;
  currency: string | null;
  availableQuantity: number;
}

interface SavedListLineRow {
  sellable_sku_id: string;
  sellable_skus: {
    finishes: { code: string } | { code: string }[];
    conditions: { code: string } | { code: string }[];
    card_printing:
      | {
          id: string;
          rarity: string;
          oracle_card: { name: string } | { name: string }[];
          set: { code: string } | { code: string }[];
        }
      | { id: string; rarity: string; oracle_card: unknown; set: unknown }[];
  } | null;
}

// Postgrest doesn't always know a nested embed is to-one without an
// explicit FK hint, so the same relation can come back as an object or a
// single-element array depending on the join path -- same ambiguity
// handled in features/staff/actions/manage-pricing-review.ts.
function single<T>(value: T | T[]): T {
  return Array.isArray(value) ? value[0] : value;
}

async function requireCustomerId(supabase: ReturnType<typeof createServerSupabaseClient>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  return user.id;
}

// Reads the current customer's saved list (backlog B-172). saved_list_lines
// has no direct customer_id column -- RLS (saved_list_lines_select, an
// EXISTS join to saved_lists.customer_id) is the only scoping here, same
// as order_lines relying on a join back to orders.
export async function getSavedList(): Promise<SavedListItem[]> {
  const supabase = createServerSupabaseClient();
  const customerId = await requireCustomerId(supabase);

  const { data: lines, error: linesError } = await supabase
    .from("saved_list_lines")
    .select(
      `
      sellable_sku_id,
      sellable_skus(
        finishes(code),
        conditions(code),
        card_printing:card_printings(
          id, rarity,
          oracle_card:oracle_cards(name),
          set:sets(code)
        )
      )
    `,
    )
    .order("created_at", { ascending: false })
    .returns<SavedListLineRow[]>();

  if (linesError) {
    logger.error("Fetch saved list failed", {
      requestId: await getRequestId(),
      customerId,
      error: logger.serializeError(linesError),
    });
    throw new Error("Failed to fetch saved list");
  }

  const rows = (lines ?? []).filter((line) => line.sellable_skus !== null);

  if (rows.length === 0) {
    return [];
  }

  const skuIds = rows.map((line) => line.sellable_sku_id);

  const [{ data: priceRows, error: priceError }, { data: balanceRows, error: balanceError }] =
    await Promise.all([
      supabase
        .from("published_prices")
        .select("sellable_sku_id, final_amount, currency")
        .in("sellable_sku_id", skuIds)
        .eq("status", "active"),
      supabase
        .from("inventory_balances")
        .select("sellable_sku_id, quantity_available_online")
        .in("sellable_sku_id", skuIds),
    ]);

  if (priceError) {
    logger.error("Fetch saved list prices failed", {
      requestId: await getRequestId(),
      customerId,
      error: logger.serializeError(priceError),
    });
    throw new Error("Failed to fetch prices for saved list");
  }
  if (balanceError) {
    logger.error("Fetch saved list availability failed", {
      requestId: await getRequestId(),
      customerId,
      error: logger.serializeError(balanceError),
    });
    throw new Error("Failed to fetch availability for saved list");
  }

  const priceBySkuId = new Map(
    (priceRows ?? []).map((row) => [
      row.sellable_sku_id,
      { amount: row.final_amount, currency: row.currency },
    ]),
  );
  const availabilityBySkuId = new Map<string, number>();
  for (const row of balanceRows ?? []) {
    availabilityBySkuId.set(
      row.sellable_sku_id,
      (availabilityBySkuId.get(row.sellable_sku_id) ?? 0) + (row.quantity_available_online ?? 0),
    );
  }

  return rows.map((line) => {
    const sku = line.sellable_skus!;
    const printing = single(sku.card_printing) as {
      id: string;
      rarity: string;
      oracle_card: { name: string } | { name: string }[];
      set: { code: string } | { code: string }[];
    };
    const price = priceBySkuId.get(line.sellable_sku_id);

    return {
      sellableSkuId: line.sellable_sku_id,
      printingId: printing.id,
      cardName: single(printing.oracle_card)?.name ?? "Unknown",
      setCode: single(printing.set)?.code ?? "",
      rarity: printing.rarity,
      conditionCode: single(sku.conditions)?.code ?? "",
      finishCode: single(sku.finishes)?.code ?? "",
      price: price?.amount ?? null,
      currency: price?.currency ?? null,
      availableQuantity: availabilityBySkuId.get(line.sellable_sku_id) ?? 0,
    };
  });
}

export async function addToSavedList(sellableSkuId: string): Promise<void> {
  const supabase = createServerSupabaseClient();
  const customerId = await requireCustomerId(supabase);

  const { error } = await supabase.rpc("add_to_saved_list", {
    p_sellable_sku_id: sellableSkuId,
  });

  if (error) {
    logger.error("Add to saved list failed", {
      requestId: await getRequestId(),
      customerId,
      sellableSkuId,
      error: logger.serializeError(error),
    });
    throw new Error("Failed to add item to saved list");
  }
}

export async function removeFromSavedList(sellableSkuId: string): Promise<void> {
  const supabase = createServerSupabaseClient();
  const customerId = await requireCustomerId(supabase);

  const { error } = await supabase.rpc("remove_from_saved_list", {
    p_sellable_sku_id: sellableSkuId,
  });

  if (error) {
    logger.error("Remove from saved list failed", {
      requestId: await getRequestId(),
      customerId,
      sellableSkuId,
      error: logger.serializeError(error),
    });
    throw new Error("Failed to remove item from saved list");
  }
}
