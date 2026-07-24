"use server";

import { createServerSupabaseClient } from "@/server/supabase";
import { logger, getRequestId } from "@/lib/logger";

export interface PricingReviewItem {
  id: string;
  status: "suggested" | "approved" | "rejected";
  base_amount: number;
  base_currency: string;
  final_amount: number;
  currency: string;
  calculated_at: string;
  rule_name: string;
  card_name: string;
  set_code: string;
  collector_number: string;
}

interface CalculatedPriceRow {
  id: string;
  status: string;
  base_amount: number;
  base_currency: string;
  final_amount: number;
  currency: string;
  calculated_at: string;
  pricing_rule: { name: string } | { name: string }[];
  sellable_sku: {
    card_printing: {
      collector_number: string;
      oracle_card: { name: string } | { name: string }[];
      set: { code: string } | { code: string }[];
    };
  };
}

function single<T>(value: T | T[]): T {
  return Array.isArray(value) ? value[0] : value;
}

// Suggested prices awaiting staff review (backlog B-163). RLS on
// calculated_prices allows any authenticated staff member to SELECT
// (calculated_prices_select, using true) -- pricing.approve/pricing.override
// gate the mutating actions below, not visibility of the queue itself.
export async function getPricingReviewQueue(): Promise<PricingReviewItem[]> {
  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("calculated_prices")
    .select(
      `
      id,
      status,
      base_amount,
      base_currency,
      final_amount,
      currency,
      calculated_at,
      pricing_rule:pricing_rules(name),
      sellable_sku:sellable_skus(
        card_printing:card_printings(
          collector_number,
          oracle_card:oracle_cards(name),
          set:sets(code)
        )
      )
    `,
    )
    .eq("status", "suggested")
    .order("calculated_at", { ascending: true })
    .limit(100)
    .returns<CalculatedPriceRow[]>();

  if (error) {
    logger.error("Fetch pricing review queue failed", {
      requestId: await getRequestId(),
      error: logger.serializeError(error),
    });
    throw new Error("Failed to fetch pricing review queue");
  }

  return (data ?? []).map((row) => {
    const printing = row.sellable_sku.card_printing;
    return {
      id: row.id,
      status: row.status as PricingReviewItem["status"],
      base_amount: row.base_amount,
      base_currency: row.base_currency,
      final_amount: row.final_amount,
      currency: row.currency,
      calculated_at: row.calculated_at,
      rule_name: single(row.pricing_rule)?.name ?? "",
      card_name: single(printing.oracle_card)?.name ?? "",
      set_code: single(printing.set)?.code ?? "",
      collector_number: printing.collector_number,
    };
  });
}

// The three mutations below all call SECURITY DEFINER functions that check
// staff_has_permission('pricing.approve'/'pricing.override') internally
// (fix in 20260724220000_fix_pricing_review_permissions.sql) -- a denied
// call surfaces here as a normal Postgres error (SQLSTATE 42501), not a
// silent no-op, so the caller can show it to the user.

export async function approvePrice(calculatedPriceId: string): Promise<void> {
  const supabase = createServerSupabaseClient();

  const { error } = await supabase.rpc("approve_suggested_price", {
    calculated_price_id: calculatedPriceId,
  });

  if (error) {
    logger.error("Approve suggested price failed", {
      requestId: await getRequestId(),
      calculatedPriceId,
      error: logger.serializeError(error),
    });
    throw new Error(error.message);
  }
}

export async function overridePrice(
  calculatedPriceId: string,
  overrideAmount: number,
): Promise<void> {
  const supabase = createServerSupabaseClient();

  const { error } = await supabase.rpc("override_suggested_price", {
    calculated_price_id: calculatedPriceId,
    override_amount: overrideAmount,
  });

  if (error) {
    logger.error("Override suggested price failed", {
      requestId: await getRequestId(),
      calculatedPriceId,
      overrideAmount,
      error: logger.serializeError(error),
    });
    throw new Error(error.message);
  }
}

export async function rejectPrice(calculatedPriceId: string): Promise<void> {
  const supabase = createServerSupabaseClient();

  const { error } = await supabase.rpc("reject_suggested_price", {
    calculated_price_id: calculatedPriceId,
  });

  if (error) {
    logger.error("Reject suggested price failed", {
      requestId: await getRequestId(),
      calculatedPriceId,
      error: logger.serializeError(error),
    });
    throw new Error(error.message);
  }
}
