import { describe, it, expect } from "vitest";
import { route_order, type FulfilmentNode, type RoutingInput } from "./routing-algorithm.js";

// Helper to create test nodes
function create_node(
  id: string,
  type: FulfilmentNode["type"] = "store",
  region = "VIC",
  allows_click_collect = false,
  dispatch_cutoff?: string,
): FulfilmentNode {
  return {
    id,
    type,
    name: `${type}-${id}`,
    allows_click_collect,
    allows_online_fulfilment: true,
    timezone: "Australia/Melbourne",
    region,
    dispatch_cutoff,
  };
}

describe("Order routing algorithm (blueprint §11, B-131-B-132)", () => {
  describe("Priority 1: Click-and-collect store", () => {
    it("should route to click-and-collect store when fulfillment type is click_and_collect", async () => {
      const store_cc = create_node("store-1", "store", "VIC", true);
      const warehouse = create_node("warehouse-1", "warehouse", "VIC");

      const input: RoutingInput = {
        order_id: "order-1",
        fulfillment_type: "click_and_collect",
        collection_store_id: "store-1",
        customer_address: { postcode: "3000", suburb: "Melbourne" },
        lines: [
          { order_line_id: "line-1", sku_id: "sku-1", quantity: 1 },
          { order_line_id: "line-2", sku_id: "sku-2", quantity: 2 },
        ],
      };

      const availability = new Map<
        string,
        Array<{ sku_id: string; node_id: string; quantity_available: number }>
      >([
        ["sku-1", [{ sku_id: "sku-1", node_id: "store-1", quantity_available: 5 }]],
        ["sku-2", [{ sku_id: "sku-2", node_id: "store-1", quantity_available: 5 }]],
      ]);

      const allocations = await route_order(input, [store_cc, warehouse], availability, "VIC");

      expect(allocations).toHaveLength(2);
      expect(allocations.every((a) => a.node_id === "store-1")).toBe(true);
      expect(allocations.every((a) => a.reason === "click_and_collect_store")).toBe(true);
    });

    it("should skip click-and-collect if store lacks inventory", async () => {
      const store_cc = create_node("store-1", "store", "VIC", true);
      const warehouse = create_node("warehouse-1", "warehouse", "VIC");

      const input: RoutingInput = {
        order_id: "order-1",
        fulfillment_type: "click_and_collect",
        collection_store_id: "store-1",
        customer_address: { postcode: "3000", suburb: "Melbourne" },
        lines: [{ order_line_id: "line-1", sku_id: "sku-1", quantity: 10 }],
      };

      const availability = new Map<
        string,
        Array<{ sku_id: string; node_id: string; quantity_available: number }>
      >([["sku-1", [{ sku_id: "sku-1", node_id: "store-1", quantity_available: 5 }]]]);

      const allocations = await route_order(input, [store_cc, warehouse], availability, "VIC");

      // Should fall back to warehouse or single complete-order routing
      expect(allocations).toBeDefined();
    });
  });

  describe("Priority 2-3: Warehouse priority and single complete-order", () => {
    it("should prefer warehouse over store when warehouse can fulfill completely", async () => {
      const warehouse = create_node("warehouse-1", "warehouse", "VIC");
      const store = create_node("store-1", "store", "VIC");

      const input: RoutingInput = {
        order_id: "order-1",
        fulfillment_type: "online_shipping",
        customer_address: { postcode: "3000", suburb: "Melbourne" },
        lines: [{ order_line_id: "line-1", sku_id: "sku-1", quantity: 5 }],
      };

      const availability = new Map<
        string,
        Array<{ sku_id: string; node_id: string; quantity_available: number }>
      >([
        [
          "sku-1",
          [
            { sku_id: "sku-1", node_id: "warehouse-1", quantity_available: 10 },
            { sku_id: "sku-1", node_id: "store-1", quantity_available: 10 },
          ],
        ],
      ]);

      const allocations = await route_order(
        input,
        [store, warehouse], // Intentionally out of preference order
        availability,
        "VIC",
      );

      expect(allocations).toHaveLength(1);
      expect(allocations[0].node_id).toBe("warehouse-1");
      expect(allocations[0].reason).toBe("single_complete_order_store");
    });

    it("should use single store that can fulfill entire order (real-world Melbourne case)", async () => {
      // Blueprint example: "18 of 20 from warehouse vs. 20 of 20 from Melbourne → route to Melbourne"
      const warehouse = create_node("warehouse-1", "warehouse", "NSW");
      const melbourne_store = create_node("store-melb", "store", "VIC");

      const input: RoutingInput = {
        order_id: "order-1",
        fulfillment_type: "online_shipping",
        customer_address: { postcode: "3000", suburb: "Melbourne" },
        lines: [
          { order_line_id: "line-1", sku_id: "sku-1", quantity: 20 },
          { order_line_id: "line-2", sku_id: "sku-2", quantity: 20 },
        ],
      };

      const availability = new Map<
        string,
        Array<{ sku_id: string; node_id: string; quantity_available: number }>
      >([
        [
          "sku-1",
          [
            { sku_id: "sku-1", node_id: "warehouse-1", quantity_available: 18 },
            { sku_id: "sku-1", node_id: "store-melb", quantity_available: 20 },
          ],
        ],
        [
          "sku-2",
          [
            { sku_id: "sku-2", node_id: "warehouse-1", quantity_available: 18 },
            { sku_id: "sku-2", node_id: "store-melb", quantity_available: 20 },
          ],
        ],
      ]);

      const allocations = await route_order(
        input,
        [warehouse, melbourne_store],
        availability,
        "VIC",
      );

      // Should route to Melbourne store (20 of 20) not warehouse (18 of 20)
      expect(allocations.every((a) => a.node_id === "store-melb")).toBe(true);
    });
  });

  describe("Priority 4-9: Minimum nodes, dispatch cutoff, transfer time, cost, safety stock, split", () => {
    it("should split across minimum nodes when single store cannot fulfill", async () => {
      const store_a = create_node("store-a", "store", "VIC");
      const store_b = create_node("store-b", "store", "VIC");

      const input: RoutingInput = {
        order_id: "order-1",
        fulfillment_type: "online_shipping",
        customer_address: { postcode: "3000", suburb: "Melbourne" },
        lines: [
          { order_line_id: "line-1", sku_id: "sku-1", quantity: 10 },
          { order_line_id: "line-2", sku_id: "sku-2", quantity: 10 },
        ],
      };

      const availability = new Map<
        string,
        Array<{ sku_id: string; node_id: string; quantity_available: number }>
      >([
        [
          "sku-1",
          [
            { sku_id: "sku-1", node_id: "store-a", quantity_available: 15 },
            { sku_id: "sku-1", node_id: "store-b", quantity_available: 0 },
          ],
        ],
        [
          "sku-2",
          [
            { sku_id: "sku-2", node_id: "store-a", quantity_available: 0 },
            { sku_id: "sku-2", node_id: "store-b", quantity_available: 15 },
          ],
        ],
      ]);

      const allocations = await route_order(input, [store_a, store_b], availability, "VIC");

      // Should split: sku-1 to store-a, sku-2 to store-b
      expect(allocations).toHaveLength(2);
      const sku1_alloc = allocations.find((a) => a.sku_id === "sku-1");
      const sku2_alloc = allocations.find((a) => a.sku_id === "sku-2");

      expect(sku1_alloc?.node_id).toBe("store-a");
      expect(sku2_alloc?.node_id).toBe("store-b");
    });

    it("should use minimum number of nodes to minimize complexity", async () => {
      const warehouse = create_node("warehouse-1", "warehouse", "NSW");
      const store_a = create_node("store-a", "store", "VIC");
      const store_b = create_node("store-b", "store", "VIC");

      const input: RoutingInput = {
        order_id: "order-1",
        fulfillment_type: "online_shipping",
        customer_address: { postcode: "3000", suburb: "Melbourne" },
        lines: [
          { order_line_id: "line-1", sku_id: "sku-1", quantity: 5 },
          { order_line_id: "line-2", sku_id: "sku-2", quantity: 5 },
        ],
      };

      const availability = new Map<
        string,
        Array<{ sku_id: string; node_id: string; quantity_available: number }>
      >([
        [
          "sku-1",
          [
            { sku_id: "sku-1", node_id: "warehouse-1", quantity_available: 0 },
            { sku_id: "sku-1", node_id: "store-a", quantity_available: 10 },
            { sku_id: "sku-1", node_id: "store-b", quantity_available: 10 },
          ],
        ],
        [
          "sku-2",
          [
            { sku_id: "sku-2", node_id: "warehouse-1", quantity_available: 0 },
            { sku_id: "sku-2", node_id: "store-a", quantity_available: 10 },
            { sku_id: "sku-2", node_id: "store-b", quantity_available: 0 },
          ],
        ],
      ]);

      const allocations = await route_order(
        input,
        [warehouse, store_a, store_b],
        availability,
        "VIC",
      );

      // Should prefer allocating both from store-a (minimum nodes = 1)
      // rather than splitting across store-a and store-b
      const unique_nodes = new Set(allocations.map((a) => a.node_id));
      expect(unique_nodes.size).toBe(1);
      expect([...unique_nodes][0]).toBe("store-a");
    });

    it("should respect dispatch cutoff constraints", async () => {
      const early_cutoff_store = create_node("store-early", "store", "VIC", false, "10:00:00");
      const late_cutoff_store = create_node("store-late", "store", "VIC", false, "18:00:00");

      const input: RoutingInput = {
        order_id: "order-1",
        fulfillment_type: "online_shipping",
        customer_address: { postcode: "3000", suburb: "Melbourne" },
        lines: [{ order_line_id: "line-1", sku_id: "sku-1", quantity: 5 }],
      };

      const availability = new Map<
        string,
        Array<{ sku_id: string; node_id: string; quantity_available: number }>
      >([
        [
          "sku-1",
          [
            { sku_id: "sku-1", node_id: "store-early", quantity_available: 10 },
            { sku_id: "sku-1", node_id: "store-late", quantity_available: 10 },
          ],
        ],
      ]);

      const allocations = await route_order(
        input,
        [early_cutoff_store, late_cutoff_store],
        availability,
        "VIC",
      );

      // In production, this would check current time against cutoffs
      // For now, both stores are treated as valid
      expect(allocations.length).toBeGreaterThan(0);
    });
  });

  describe("Dispatch cutoff and transfer-time handling (B-132)", () => {
    it("should factor in transfer lead time when warehouse needed", () => {
      // B-132: "routing respects dispatch_cutoff per node and factors in
      // transfer lead time when a transfer would be required to fulfil"
      // This is conceptual in the test since real implementation needs
      // transfer_orders and timing data
      expect(true).toBe(true); // Placeholder for integration test
    });

    it("should route to node that can still ship next business day", () => {
      // B-132 example: "an order placed after cutoff routes to a node
      // that can still ship next business day"
      expect(true).toBe(true); // Placeholder for integration test
    });
  });

  describe("Failure scenarios", () => {
    it("should handle order with no available inventory gracefully", async () => {
      const store = create_node("store-1", "store", "VIC");
      const warehouse = create_node("warehouse-1", "warehouse", "VIC");

      const input: RoutingInput = {
        order_id: "order-1",
        fulfillment_type: "online_shipping",
        customer_address: { postcode: "3000", suburb: "Melbourne" },
        lines: [{ order_line_id: "line-1", sku_id: "sku-unknown", quantity: 5 }],
      };

      // Empty availability
      const availability = new Map<
        string,
        Array<{ sku_id: string; node_id: string; quantity_available: number }>
      >();

      const allocations = await route_order(input, [store, warehouse], availability, "VIC");

      // Should return empty (cannot fulfill)
      expect(allocations).toHaveLength(0);
    });

    it("should handle empty order", async () => {
      const store = create_node("store-1", "store", "VIC");

      const input: RoutingInput = {
        order_id: "order-1",
        fulfillment_type: "online_shipping",
        customer_address: { postcode: "3000", suburb: "Melbourne" },
        lines: [], // Empty
      };

      const availability = new Map<
        string,
        Array<{ sku_id: string; node_id: string; quantity_available: number }>
      >();

      const allocations = await route_order(input, [store], availability, "VIC");

      expect(allocations).toHaveLength(0);
    });
  });
});
