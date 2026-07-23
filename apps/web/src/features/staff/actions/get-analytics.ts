"use server";

import { createServerSupabaseClient } from "@/server/supabase";
import { getStaffContext } from "@/server/staff-context";

interface OrderRow {
  id: string;
  created_at: string;
  total_amount: number;
  status: string;
}

interface OrderLineRow {
  quantity: number;
  unit_price: number;
  card_printings: Array<{
    cards: { name: string } | null;
    sets: { name: string } | null;
  }> | null;
  created_at?: string;
}

interface PricingMetadata {
  published?: {
    event_type?: string;
  };
  overridden?: boolean;
}

interface PricingRow {
  id: string;
  status: string;
  metadata: PricingMetadata | null;
  created_at?: string;
}

export interface OrderTrend {
  date: string;
  count: number;
  revenue: number;
}

export interface PopularCard {
  card_name: string;
  set_name: string;
  total_units: number;
  total_revenue: number;
}

export interface PricingStats {
  average_margin_percent: number;
  cards_in_review: number;
  auto_approved_count: number;
  manual_approved_count: number;
  approval_rate_percent: number;
}

export interface FulfillmentBreakdown {
  status: string;
  count: number;
  percentage: number;
}

export interface AnalyticsData {
  orderTrends: OrderTrend[];
  popularCards: PopularCard[];
  pricingStats: PricingStats;
  fulfillmentBreakdown: FulfillmentBreakdown[];
  exceptionCount: number;
  totalOrders: number;
  totalRevenue: number;
}

export async function getAnalyticsData(): Promise<AnalyticsData> {
  const staffContext = await getStaffContext();

  if (!staffContext) {
    throw new Error("Not authenticated as staff");
  }

  const supabase = createServerSupabaseClient();

  // Get order trends (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: ordersData, error: ordersError } = await supabase
    .from("orders")
    .select("id, created_at, total_amount, status")
    .gte("created_at", thirtyDaysAgo.toISOString())
    .order("created_at", { ascending: true });

  if (ordersError) {
    console.error("Fetch orders error:", ordersError);
    throw new Error("Failed to fetch orders");
  }

  // Process order trends
  const trendMap = new Map<string, { count: number; revenue: number }>();
  ((ordersData || []) as unknown as OrderRow[]).forEach((order: OrderRow) => {
    const date = new Date(order.created_at).toLocaleDateString("en-AU");
    const existing = trendMap.get(date) || { count: 0, revenue: 0 };
    trendMap.set(date, {
      count: existing.count + 1,
      revenue: existing.revenue + order.total_amount / 100,
    });
  });

  const orderTrends = Array.from(trendMap.entries())
    .map(([date, data]) => ({
      date,
      count: data.count,
      revenue: data.revenue,
    }))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Get popular cards
  const { data: linesData, error: linesError } = await supabase
    .from("order_lines")
    .select("quantity, unit_price, card_printings(cards(name), sets(name))")
    .gte("created_at", thirtyDaysAgo.toISOString());

  if (linesError) {
    console.error("Fetch order lines error:", linesError);
    throw new Error("Failed to fetch order lines");
  }

  const cardMap = new Map<string, { units: number; revenue: number }>();
  ((linesData || []) as unknown as OrderLineRow[]).forEach((line: OrderLineRow) => {
    const cardName = line.card_printings?.[0]?.cards?.name || "Unknown";
    const setName = line.card_printings?.[0]?.sets?.name || "Unknown";
    const key = `${cardName}|${setName}`;
    const existing = cardMap.get(key) || { units: 0, revenue: 0 };
    cardMap.set(key, {
      units: existing.units + line.quantity,
      revenue: existing.revenue + (line.unit_price * line.quantity) / 100,
    });
  });

  const popularCards: PopularCard[] = Array.from(cardMap.entries())
    .map(([key, data]) => {
      const [cardName, setName] = key.split("|");
      return {
        card_name: cardName,
        set_name: setName,
        total_units: data.units,
        total_revenue: data.revenue,
      };
    })
    .sort((a, b) => b.total_units - a.total_units)
    .slice(0, 10);

  // Get pricing stats
  const { data: pricingData, error: pricingError } = await supabase
    .from("calculated_prices")
    .select("id, status, metadata")
    .gte("created_at", thirtyDaysAgo.toISOString());

  if (pricingError) {
    console.error("Fetch pricing data error:", pricingError);
    throw new Error("Failed to fetch pricing data");
  }

  const autoApproved = ((pricingData || []) as unknown as PricingRow[]).filter(
    (p: PricingRow) => p.metadata?.published?.event_type === "pricing_approved" && !p.metadata?.overridden,
  ).length;
  const manualApproved = ((pricingData || []) as unknown as PricingRow[]).filter((p: PricingRow) => p.status === "approved").length;
  const cardsInReview = ((pricingData || []) as unknown as PricingRow[]).filter((p: PricingRow) => p.status === "suggested").length;

  const pricingStats: PricingStats = {
    average_margin_percent: 25, // Placeholder - would calculate from actual prices
    cards_in_review: cardsInReview,
    auto_approved_count: autoApproved,
    manual_approved_count: manualApproved,
    approval_rate_percent: autoApproved + manualApproved > 0 ? ((autoApproved + manualApproved) / (pricingData?.length || 1)) * 100 : 0,
  };

  // Get fulfillment breakdown
  const { data: allOrders, error: allOrdersError } = await supabase
    .from("orders")
    .select("status");

  if (allOrdersError) {
    console.error("Fetch all orders error:", allOrdersError);
    throw new Error("Failed to fetch orders for breakdown");
  }

  const statusCounts = new Map<string, number>();
  ((allOrders || []) as unknown as OrderRow[]).forEach((order: OrderRow) => {
    statusCounts.set(order.status, (statusCounts.get(order.status) || 0) + 1);
  });

  const totalOrders = allOrders?.length || 0;
  const fulfillmentBreakdown: FulfillmentBreakdown[] = Array.from(statusCounts.entries()).map(
    ([status, count]) => ({
      status,
      count,
      percentage: totalOrders > 0 ? (count / totalOrders) * 100 : 0,
    }),
  );

  // Get exception count
  const { data: exceptionsData, error: exceptionsError } = await supabase
    .from("pick_exceptions")
    .select("id");

  if (exceptionsError) {
    console.error("Fetch exceptions error:", exceptionsError);
  }

  const exceptionCount = exceptionsData?.length || 0;

  // Calculate total revenue
  const totalRevenue = ((ordersData || []) as unknown as OrderRow[]).reduce((sum: number, order: OrderRow) => sum + order.total_amount / 100, 0);

  return {
    orderTrends,
    popularCards,
    pricingStats,
    fulfillmentBreakdown,
    exceptionCount,
    totalOrders,
    totalRevenue,
  };
}
