import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Sql } from "postgres";

const mockPatchPopularityScore = vi.fn();

vi.mock("../search/index-store.js", () => ({
  patchPopularityScore: (...args: unknown[]) => mockPatchPopularityScore(...args),
}));

function createMockSql(rows: unknown[]): Sql {
  return (() => Promise.resolve(rows)) as unknown as Sql;
}

describe("fetchPopularityMetrics", () => {
  it("maps aggregated rows into per-SKU metrics, defaulting a never-sold SKU to a large recency gap", async () => {
    const sql = createMockSql([
      {
        sku_id: "sku-1",
        total_orders: "3",
        total_quantity_sold: "12",
        last_sale_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        inventory_depth: "40",
        availability_stores: "2",
      },
      {
        sku_id: "sku-2",
        total_orders: "0",
        total_quantity_sold: "0",
        last_sale_at: null,
        inventory_depth: "10",
        availability_stores: "1",
      },
    ]);

    const { fetchPopularityMetrics } = await import("./calculate-popularity-score.js");
    const metrics = await fetchPopularityMetrics(sql);

    expect(metrics.get("sku-1")).toMatchObject({
      totalOrders: 3,
      totalQuantitySold: 12,
      inventoryDepth: 40,
      availabilityStores: 2,
      daysSinceLastSale: 5,
    });
    expect(metrics.get("sku-2")?.daysSinceLastSale).toBeGreaterThan(1000);
  });
});

describe("updateAllPopularityScores", () => {
  beforeEach(() => {
    mockPatchPopularityScore.mockReset();
  });

  it("patches each SKU's computed score into the live search index", async () => {
    const sql = createMockSql([
      {
        sku_id: "sku-1",
        total_orders: "100",
        total_quantity_sold: "500",
        last_sale_at: new Date().toISOString(),
        inventory_depth: "50",
        availability_stores: "10",
      },
    ]);
    mockPatchPopularityScore.mockReturnValue(true);

    const { updateAllPopularityScores } = await import("./calculate-popularity-score.js");
    const result = await updateAllPopularityScores(sql);

    expect(mockPatchPopularityScore).toHaveBeenCalledWith("sku-1", 100);
    expect(result).toMatchObject({ status: "completed", updated: 1, failed: 0 });
  });

  it("counts SKUs not yet present in the search index as failed, not fatal", async () => {
    const sql = createMockSql([
      {
        sku_id: "sku-1",
        total_orders: "0",
        total_quantity_sold: "0",
        last_sale_at: null,
        inventory_depth: "0",
        availability_stores: "0",
      },
    ]);
    mockPatchPopularityScore.mockReturnValue(false);

    const { updateAllPopularityScores } = await import("./calculate-popularity-score.js");
    const result = await updateAllPopularityScores(sql);

    expect(result).toMatchObject({ status: "completed", updated: 0, failed: 1 });
  });

  it("returns a 'failed' result instead of throwing when the metrics query fails", async () => {
    const sql = (() => Promise.reject(new Error("connection refused"))) as unknown as Sql;

    const { updateAllPopularityScores } = await import("./calculate-popularity-score.js");
    const result = await updateAllPopularityScores(sql);

    expect(result).toMatchObject({ status: "failed", error: "connection refused" });
    expect(mockPatchPopularityScore).not.toHaveBeenCalled();
  });
});
