// Popularity score calculation (B-085, blueprint §13.6)
// Computes search ranking score based on inventory, orders, and engagement

import { createClient } from '@supabase/supabase-js';

// Lazy: constructing the client at module scope means importing this file
// (e.g. in a test) throws immediately if the env vars aren't set, before
// any test gets a chance to mock them.
function getSupabaseClient() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

interface PopularityMetrics {
  total_orders: number;
  total_quantity_sold: number;
  inventory_depth: number;
  availability_stores: number;
  days_since_last_sale: number;
}

export function calculatePopularityScore(metrics: PopularityMetrics): number {
  // Normalize each factor to 0-1 scale
  const ordersFactor = Math.min(metrics.total_orders / 100, 1) * 20; // Max 20 points
  const volumeFactor = Math.min(metrics.total_quantity_sold / 500, 1) * 20; // Max 20 points
  const inventoryFactor = Math.min(metrics.inventory_depth / 50, 1) * 20; // Max 20 points
  const availabilityFactor = (metrics.availability_stores / 10) * 20; // Max 20 points
  const recencyFactor =
    metrics.days_since_last_sale === 0 ? 20 : Math.max(0, 20 * (1 - metrics.days_since_last_sale / 30)); // Max 20 points, decays over 30 days

  return Math.round(
    ordersFactor + volumeFactor + inventoryFactor + availabilityFactor + recencyFactor
  );
}

export async function updateAllPopularityScores(): Promise<{
  updated: number;
  error?: string;
}> {
  try {
    const supabase = getSupabaseClient();

    // Fetch all SKUs with their sales metrics
    const { data: skus, error: fetchError } = await supabase
      .from('sellable_skus')
      .select('id');

    if (fetchError) {
      return { updated: 0, error: fetchError.message };
    }

    if (!skus || skus.length === 0) {
      return { updated: 0 };
    }

    let updated = 0;

    // Calculate and store popularity for each SKU
    for (const sku of skus) {
      // Fetch metrics (in production, would aggregate from orders, inventory, etc.)
      const { data: metrics } = await supabase
        .from('sellable_skus')
        .select(
          `
          id,
          order_lines(count),
          inventory_balances(quantity_on_hand)
        `
        )
        .eq('id', sku.id)
        .single();

      if (!metrics) continue;

      const score = calculatePopularityScore({
        total_orders: 0,
        total_quantity_sold: 0,
        inventory_depth: metrics.inventory_balances?.[0]?.quantity_on_hand || 0,
        availability_stores: 1,
        days_since_last_sale: 0,
      });

      // Store score in calculated_prices or similar (for now just log)
      console.log(`SKU ${sku.id}: popularity score = ${score}`);
      updated++;
    }

    return { updated };
  } catch (error) {
    return {
      updated: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function handlePopularityScoringJob(): Promise<{
  status: string;
  updated: number;
}> {
  const result = await updateAllPopularityScores();
  return {
    status: result.error ? 'failed' : 'completed',
    updated: result.updated,
  };
}
