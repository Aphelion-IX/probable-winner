import { describe, expect, it, vi, beforeEach } from "vitest";

// Isolated in its own file so mocking @/server/supabase and
// @/server/staff-context works reliably — same reasoning as
// generate-pick-batch.test.ts.
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
  roleCode: "inventory_manager",
  permissions: ["inventory.view", "inventory.transfer"],
  nodeId: "node-1",
  nodeIds: ["node-1", "node-2"],
  scopeType: "selected_stores",
};

describe("dispatchTransfer", () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockGetStaffContext.mockReset();
  });

  it("calls dispatch_transfer for a permitted staff member", async () => {
    mockGetStaffContext.mockResolvedValue(STAFF);
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { dispatchTransfer } = await import("./manage-transfers");

    const result = await dispatchTransfer("transfer-1");

    expect(result).toEqual({ success: true, transferId: "transfer-1" });
    expect(mockRpc).toHaveBeenCalledWith("dispatch_transfer", {
      p_transfer_order_id: "transfer-1",
    });
  });

  it("refuses without inventory.transfer", async () => {
    mockGetStaffContext.mockResolvedValue({ ...STAFF, permissions: ["inventory.view"] });
    const { dispatchTransfer } = await import("./manage-transfers");

    const result = await dispatchTransfer("transfer-1");

    expect(result.success).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("surfaces the database error when the transfer is in the wrong state", async () => {
    mockGetStaffContext.mockResolvedValue(STAFF);
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "transfer order is draft, not picking -- cannot dispatch" },
    });
    const { dispatchTransfer } = await import("./manage-transfers");

    const result = await dispatchTransfer("transfer-1");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/cannot dispatch/);
  });
});

describe("receiveTransfer", () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockGetStaffContext.mockReset();
  });

  it("maps lines to the jsonb shape receive_transfer expects", async () => {
    mockGetStaffContext.mockResolvedValue(STAFF);
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { receiveTransfer } = await import("./manage-transfers");

    const result = await receiveTransfer("transfer-1", [
      { skuId: "sku-1", good: 3, damaged: 1, missing: 0 },
    ]);

    expect(result.success).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith("receive_transfer", {
      p_transfer_order_id: "transfer-1",
      p_lines: [
        { sellableSkuId: "sku-1", quantityGood: 3, quantityDamaged: 1, quantityMissing: 0 },
      ],
    });
  });

  it("drops all-zero lines the receiver left blank", async () => {
    mockGetStaffContext.mockResolvedValue(STAFF);
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { receiveTransfer } = await import("./manage-transfers");

    await receiveTransfer("transfer-1", [
      { skuId: "sku-1", good: 2, damaged: 0, missing: 0 },
      { skuId: "sku-2", good: 0, damaged: 0, missing: 0 },
    ]);

    const payload = mockRpc.mock.calls[0][1].p_lines;
    expect(payload).toHaveLength(1);
    expect(payload[0].sellableSkuId).toBe("sku-1");
  });

  it("refuses when every line is blank rather than calling the RPC", async () => {
    mockGetStaffContext.mockResolvedValue(STAFF);
    const { receiveTransfer } = await import("./manage-transfers");

    const result = await receiveTransfer("transfer-1", [
      { skuId: "sku-1", good: 0, damaged: 0, missing: 0 },
    ]);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/at least one line/);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe("updateTransferStatus", () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockGetStaffContext.mockReset();
  });

  it("refuses to set a status that moves stock", async () => {
    mockGetStaffContext.mockResolvedValue(STAFF);
    const { updateTransferStatus } = await import("./manage-transfers");

    // dispatched/received change inventory and must go through
    // dispatch_transfer()/receive_transfer(), never a plain status write.
    for (const status of ["dispatched", "received", "partially_received"]) {
      const result = await updateTransferStatus("transfer-1", status);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not a status you can set by hand/);
    }
  });
});
