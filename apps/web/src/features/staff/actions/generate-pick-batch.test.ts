import { describe, expect, it, vi, beforeEach } from "vitest";

// Isolated in its own file so mocking @/server/supabase and
// @/server/staff-context works reliably — same reasoning as
// add-all-to-cart.test.ts.
const mockRpc = vi.fn();
const mockGetStaffContext = vi.fn();

vi.mock("@/server/supabase", () => ({
  createServerSupabaseClient: () => ({ rpc: mockRpc }),
}));

vi.mock("@/server/staff-context", () => ({
  getStaffContext: () => mockGetStaffContext(),
}));

describe("generatePickBatch", () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockGetStaffContext.mockReset();
  });

  it("returns an error without calling the RPC when there is no staff context", async () => {
    mockGetStaffContext.mockResolvedValue(null);
    const { generatePickBatch } = await import("./generate-pick-batch");

    const result = await generatePickBatch();

    expect(result).toEqual({ success: false, error: "Not authenticated as staff" });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("calls create_pick_batch with the staff member's node and returns the batch id", async () => {
    mockGetStaffContext.mockResolvedValue({
      userId: "user-1",
      nodeId: "node-1",
      nodeIds: ["node-1"],
      scopeType: "store",
    });
    mockRpc.mockResolvedValue({ data: "batch-1", error: null });
    const { generatePickBatch } = await import("./generate-pick-batch");

    const result = await generatePickBatch();

    expect(mockRpc).toHaveBeenCalledWith("create_pick_batch", { p_fulfilment_node_id: "node-1" });
    expect(result).toEqual({ success: true, batchId: "batch-1" });
  });

  it("surfaces an RPC error (e.g. no pending allocations at the node)", async () => {
    mockGetStaffContext.mockResolvedValue({
      userId: "user-1",
      nodeId: "node-1",
      nodeIds: ["node-1"],
      scopeType: "store",
    });
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "create_pick_batch: no pending allocations found at node node-1" },
    });
    const { generatePickBatch } = await import("./generate-pick-batch");

    const result = await generatePickBatch();

    expect(result).toEqual({
      success: false,
      error: "create_pick_batch: no pending allocations found at node node-1",
    });
  });
});
