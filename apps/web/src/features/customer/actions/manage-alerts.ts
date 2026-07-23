"use server";

import { createServerSupabaseClient } from "@/server/supabase";

interface PriceAlertRow {
  id: string;
  card_printing_id: string;
  finish: "normal" | "foil" | "etched";
  alert_price: number;
  currency: string;
  status: "active" | "triggered" | "inactive";
  triggered_at: string | null;
  created_at: string;
  card_printings: Array<{
    cards: { name: string } | null;
    sets: { name: string } | null;
  }>;
}

interface RestockAlertRow {
  id: string;
  card_printing_id: string;
  finish: "normal" | "foil" | "etched";
  condition: string;
  status: "active" | "triggered" | "inactive";
  triggered_at: string | null;
  created_at: string;
  card_printings: Array<{
    cards: { name: string } | null;
    sets: { name: string } | null;
  }>;
}

export interface CustomerPriceAlert {
  id: string;
  card_printing_id: string;
  card_name: string;
  set_name: string;
  finish: "normal" | "foil" | "etched";
  alert_price: number;
  currency: string;
  status: "active" | "triggered" | "inactive";
  triggered_at: string | null;
  created_at: string;
}

export interface CustomerRestockAlert {
  id: string;
  card_printing_id: string;
  card_name: string;
  set_name: string;
  finish: "normal" | "foil" | "etched";
  condition: string;
  status: "active" | "triggered" | "inactive";
  triggered_at: string | null;
  created_at: string;
}

export async function getCustomerAlerts() {
  const supabase = createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  const [priceAlertsData, restockAlertsData] = await Promise.all([
    supabase
      .from("price_alerts")
      .select(
        `
        id, card_printing_id, finish, alert_price, currency, status, triggered_at, created_at,
        card_printings(cards(name), sets(name))
      `,
      )
      .eq("customer_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("restock_alerts")
      .select(
        `
        id, card_printing_id, finish, condition, status, triggered_at, created_at,
        card_printings(cards(name), sets(name))
      `,
      )
      .eq("customer_id", user.id)
      .order("created_at", { ascending: false }),
  ]);

  if (priceAlertsData.error) {
    console.error("Fetch price alerts error:", priceAlertsData.error);
    throw new Error("Failed to fetch price alerts");
  }

  if (restockAlertsData.error) {
    console.error("Fetch restock alerts error:", restockAlertsData.error);
    throw new Error("Failed to fetch restock alerts");
  }

  const priceAlerts: CustomerPriceAlert[] = ((priceAlertsData.data || []) as unknown as PriceAlertRow[]).map((alert: PriceAlertRow) => ({
    id: alert.id,
    card_printing_id: alert.card_printing_id,
    card_name: alert.card_printings?.[0]?.cards?.name || "Unknown",
    set_name: alert.card_printings?.[0]?.sets?.name || "Unknown",
    finish: alert.finish,
    alert_price: alert.alert_price,
    currency: alert.currency,
    status: alert.status,
    triggered_at: alert.triggered_at,
    created_at: alert.created_at,
  }));

  const restockAlerts: CustomerRestockAlert[] = ((restockAlertsData.data || []) as unknown as RestockAlertRow[]).map((alert: RestockAlertRow) => ({
    id: alert.id,
    card_printing_id: alert.card_printing_id,
    card_name: alert.card_printings?.[0]?.cards?.name || "Unknown",
    set_name: alert.card_printings?.[0]?.sets?.name || "Unknown",
    finish: alert.finish,
    condition: alert.condition,
    status: alert.status,
    triggered_at: alert.triggered_at,
    created_at: alert.created_at,
  }));

  return { priceAlerts, restockAlerts };
}

export async function createPriceAlert(
  cardPrintingId: string,
  finish: string,
  alertPrice: number,
  currency: string,
): Promise<string> {
  const supabase = createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  const { data, error } = await supabase.rpc("upsert_price_alert", {
    p_card_printing_id: cardPrintingId,
    p_finish: finish,
    p_alert_price: alertPrice,
    p_currency: currency,
  });

  if (error) {
    console.error("Create price alert error:", error);
    throw new Error("Failed to create price alert");
  }

  return data as string;
}

export async function createRestockAlert(
  cardPrintingId: string,
  finish: string,
  condition: string,
): Promise<string> {
  const supabase = createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  const { data, error } = await supabase.rpc("upsert_restock_alert", {
    p_card_printing_id: cardPrintingId,
    p_finish: finish,
    p_condition: condition,
  });

  if (error) {
    console.error("Create restock alert error:", error);
    throw new Error("Failed to create restock alert");
  }

  return data as string;
}

export async function deleteAlert(alertId: string, type: "price" | "restock"): Promise<void> {
  const supabase = createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  const tableName = type === "price" ? "price_alerts" : "restock_alerts";

  const { error } = await supabase
    .from(tableName)
    .delete()
    .eq("id", alertId)
    .eq("customer_id", user.id);

  if (error) {
    console.error(`Delete ${type} alert error:`, error);
    throw new Error(`Failed to delete ${type} alert`);
  }
}
