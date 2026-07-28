import { describe, expect, it, vi, beforeEach } from "vitest";

// Isolated in its own file so mocking @/server/supabase and
// @/server/staff-context works reliably -- same reasoning as
// manage-inventory.test.ts.
const mockRpc = vi.fn();
const mockGetStaffContext = vi.fn();

vi.mock("@/server/supabase", () => ({
  createServerSupabaseClient: () => ({ rpc: mockRpc }),
}));

vi.mock("@/server/staff-context", () => ({
  getStaffContext: () => mockGetStaffContext(),
}));

const STAFF = {
  userId: "user-1",
  organisationId: "org-1",
  roleCode: "store_manager",
  permissions: ["inventory.view", "inventory.receive"],
  nodeId: "node-1",
  nodeIds: ["node-1", "node-2"],
  scopeType: "selected_stores",
};

describe("receiveStockBulk", () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockGetStaffContext.mockReset();
  });

  it("calls receive_inventory once per line, tagged with a shared batch id", async () => {
    mockGetStaffContext.mockResolvedValue(STAFF);
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { receiveStockBulk } = await import("./manage-receiving");

    const result = await receiveStockBulk({
      nodeId: "node-1",
      lines: [
        { skuId: "sku-1", quantity: 4 },
        { skuId: "sku-2", quantity: 10 },
      ],
      reason: "PO-4821",
    });

    expect(result.success).toBe(true);
    expect(result.lineResults).toEqual([
      { skuId: "sku-1", quantity: 4, success: true, error: undefined },
      { skuId: "sku-2", quantity: 10, success: true, error: undefined },
    ]);
    expect(mockRpc).toHaveBeenCalledTimes(2);

    const [firstCall, secondCall] = mockRpc.mock.calls;
    expect(firstCall[0]).toBe("receive_inventory");
    expect(firstCall[1]).toMatchObject({
      p_fulfilment_node_id: "node-1",
      p_sellable_sku_id: "sku-1",
      p_quantity: 4,
      p_reference_type: "bulk_receive",
      p_reason: "PO-4821",
    });
    expect(secondCall[1]).toMatchObject({
      p_sellable_sku_id: "sku-2",
      p_quantity: 10,
    });
    // Every line in one batch shares the same reference_id.
    expect(firstCall[1].p_reference_id).toBe(secondCall[1].p_reference_id);
    expect(result.batchId).toBe(firstCall[1].p_reference_id);
  });

  it("reports partial failure without aborting remaining lines", async () => {
    mockGetStaffContext.mockResolvedValue(STAFF);
    mockRpc
      .mockResolvedValueOnce({ data: null, error: { message: "unknown SKU" } })
      .mockResolvedValueOnce({ data: null, error: null });
    const { receiveStockBulk } = await import("./manage-receiving");

    const result = await receiveStockBulk({
      nodeId: "node-1",
      lines: [
        { skuId: "sku-bad", quantity: 1 },
        { skuId: "sku-2", quantity: 2 },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/1 of 2/);
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(result.lineResults).toEqual([
      { skuId: "sku-bad", quantity: 1, success: false, error: "unknown SKU" },
      { skuId: "sku-2", quantity: 2, success: true, error: undefined },
    ]);
  });

  it("refuses a node outside the staff member's scope without calling the RPC", async () => {
    mockGetStaffContext.mockResolvedValue(STAFF);
    const { receiveStockBulk } = await import("./manage-receiving");

    const result = await receiveStockBulk({
      nodeId: "node-99",
      lines: [{ skuId: "sku-1", quantity: 1 }],
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/outside your scope/);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("refuses when the role lacks inventory.receive", async () => {
    mockGetStaffContext.mockResolvedValue({ ...STAFF, permissions: ["inventory.view"] });
    const { receiveStockBulk } = await import("./manage-receiving");

    const result = await receiveStockBulk({
      nodeId: "node-1",
      lines: [{ skuId: "sku-1", quantity: 1 }],
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/inventory\.receive/);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects an empty batch", async () => {
    mockGetStaffContext.mockResolvedValue(STAFF);
    const { receiveStockBulk } = await import("./manage-receiving");

    const result = await receiveStockBulk({ nodeId: "node-1", lines: [] });

    expect(result.success).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects a batch over the line limit", async () => {
    mockGetStaffContext.mockResolvedValue(STAFF);
    const { receiveStockBulk } = await import("./manage-receiving");
    const { MAX_BULK_RECEIVE_LINES } = await import("@/features/staff/receiving-constants");

    const lines = Array.from({ length: MAX_BULK_RECEIVE_LINES + 1 }, (_, i) => ({
      skuId: `sku-${i}`,
      quantity: 1,
    }));
    const result = await receiveStockBulk({ nodeId: "node-1", lines });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/limited to/);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects a non-positive or fractional quantity anywhere in the batch", async () => {
    mockGetStaffContext.mockResolvedValue(STAFF);
    const { receiveStockBulk } = await import("./manage-receiving");

    const result = await receiveStockBulk({
      nodeId: "node-1",
      lines: [
        { skuId: "sku-1", quantity: 2 },
        { skuId: "sku-2", quantity: 0 },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/positive whole quantity/);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("returns an error without calling the RPC when there is no staff session", async () => {
    mockGetStaffContext.mockResolvedValue(null);
    const { receiveStockBulk } = await import("./manage-receiving");

    const result = await receiveStockBulk({
      nodeId: "node-1",
      lines: [{ skuId: "sku-1", quantity: 1 }],
    });

    expect(result).toEqual({ success: false, error: "Not authenticated as staff" });
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
