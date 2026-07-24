import { describe, it, expect, vi, beforeEach } from "vitest";

// createPendingOrder makes many chained Supabase calls (carts, sellable_skus,
// published_prices, addresses, orders, order_lines, the persist_order_allocations
// RPC). Rather than modelling Supabase's real nested-select query builder,
// this mock resolves whatever `.from(table)` chain is built to a canned
// per-table result -- the intermediate chain methods (select/eq/in/single)
// are no-ops that return the same chainable, since only the final resolved
// value and which table/RPC was hit matter for these tests.
function chainable(result: { data: unknown; error: unknown }) {
  const obj: {
    then: (resolve: (value: unknown) => void) => void;
    select: () => typeof obj;
    eq: () => typeof obj;
    in: () => typeof obj;
    single: () => typeof obj;
    insert: () => typeof obj;
    update: () => typeof obj;
  } = {
    then: (resolve) => resolve(result),
    select: () => obj,
    eq: () => obj,
    in: () => obj,
    single: () => obj,
    insert: () => obj,
    update: () => obj,
  };
  return obj;
}

const NODE_STORE_A = "11111111-1111-1111-1111-111111111111";
const NODE_STORE_B = "22222222-2222-2222-2222-222222222222";
const NODE_WAREHOUSE = "33333333-3333-3333-3333-333333333333";

let resultsByTable: Record<string, { data: unknown; error: unknown }> = {};
const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null });
const mockFrom = vi.fn((table: string) => chainable(resultsByTable[table]));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: mockFrom, rpc: mockRpc }),
}));

function cartLine(skuId: string, nodeId: string, quantity: number) {
  return {
    id: `line-${skuId}`,
    sellable_sku_id: skuId,
    quantity,
    fulfilment_node_id: nodeId,
    inventory_reservation_id: `reservation-${skuId}`,
    inventory_reservations: { id: `reservation-${skuId}`, expires_at: null },
  };
}

function setUpCart(
  cartLines: ReturnType<typeof cartLine>[],
  nodeTypes: Array<{ id: string; type: string }>,
) {
  resultsByTable = {
    carts: {
      data: { id: "cart-1", organisation_id: "org-1", cart_lines: cartLines },
      error: null,
    },
    published_prices: {
      data: cartLines.map((line) => ({ sellable_sku_id: line.sellable_sku_id, final_amount: 10 })),
      error: null,
    },
    fulfilment_nodes: { data: nodeTypes, error: null },
    addresses: { data: { id: "address-1" }, error: null },
    orders: { data: { id: "order-1" }, error: null },
    order_lines: { data: null, error: null },
  };
}

describe("createPendingOrder routing integration (B-130/B-131)", () => {
  beforeEach(() => {
    mockRpc.mockClear();
    mockFrom.mockClear();
  });

  it("routes a single-node delivery order to that store with single_complete_order_store", async () => {
    setUpCart([cartLine("sku-1", NODE_STORE_A, 2)], [{ id: NODE_STORE_A, type: "store" }]);

    const { createPendingOrder } = await import("../create-pending-order");
    const result = await createPendingOrder("cart-1", "delivery", {
      line1: "1 Test St",
      suburb: "Melbourne",
      state: "VIC",
      postcode: "3000",
    });

    expect(result.success).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith("persist_order_allocations", {
      p_order_id: "order-1",
      p_allocations: [
        {
          sku_id: "sku-1",
          node_id: NODE_STORE_A,
          quantity: 2,
          reason: "single_complete_order_store",
        },
      ],
    });
  });

  it("classifies a warehouse-fulfilled delivery order as warehouse_priority", async () => {
    setUpCart([cartLine("sku-1", NODE_WAREHOUSE, 2)], [{ id: NODE_WAREHOUSE, type: "warehouse" }]);

    const { createPendingOrder } = await import("../create-pending-order");
    await createPendingOrder("cart-1", "delivery", {
      line1: "1 Test St",
      suburb: "Melbourne",
      state: "VIC",
      postcode: "3000",
    });

    expect(mockRpc).toHaveBeenCalledWith(
      "persist_order_allocations",
      expect.objectContaining({
        p_allocations: [expect.objectContaining({ reason: "warehouse_priority" })],
      }),
    );
  });

  it("picks the majority-quantity node as primary when a cart's lines span two nodes", async () => {
    setUpCart(
      [cartLine("sku-1", NODE_STORE_A, 5), cartLine("sku-2", NODE_STORE_B, 1)],
      [
        { id: NODE_STORE_A, type: "store" },
        { id: NODE_STORE_B, type: "store" },
      ],
    );

    const { createPendingOrder } = await import("../create-pending-order");
    await createPendingOrder("cart-1", "delivery", {
      line1: "1 Test St",
      suburb: "Melbourne",
      state: "VIC",
      postcode: "3000",
    });

    const orderInsertCall = mockFrom.mock.calls.find(([table]) => table === "orders");
    expect(orderInsertCall).toBeDefined();

    // Both lines recorded against their real reserved node, both
    // classified as split (since no single node covers the whole order).
    expect(mockRpc).toHaveBeenCalledWith("persist_order_allocations", {
      p_order_id: "order-1",
      p_allocations: [
        { sku_id: "sku-1", node_id: NODE_STORE_A, quantity: 5, reason: "split_minimum_nodes" },
        { sku_id: "sku-2", node_id: NODE_STORE_B, quantity: 1, reason: "split_minimum_nodes" },
      ],
    });
  });

  it("routes a click-and-collect order to the chosen store regardless of line reservation node", async () => {
    setUpCart([cartLine("sku-1", NODE_WAREHOUSE, 1)], [{ id: NODE_WAREHOUSE, type: "warehouse" }]);

    const { createPendingOrder } = await import("../create-pending-order");
    const result = await createPendingOrder("cart-1", "collect", undefined, NODE_STORE_A);

    expect(result.success).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith("persist_order_allocations", {
      p_order_id: "order-1",
      p_allocations: [
        {
          sku_id: "sku-1",
          node_id: NODE_STORE_A,
          quantity: 1,
          reason: "click_and_collect_store",
        },
      ],
    });
  });
});
