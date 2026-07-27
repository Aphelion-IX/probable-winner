import { describe, expect, it, vi, beforeEach } from "vitest";

// Isolated in its own file so mocking @/server/supabase works reliably —
// same reasoning as generate-pick-batch.test.ts.
const mockRpc = vi.fn();

vi.mock("@/server/supabase", () => ({
  createServerSupabaseClient: () => ({ rpc: mockRpc }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe("beginPickBatch", () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it("calls begin_pick_batch with the batch id", async () => {
    mockRpc.mockResolvedValue({ error: null });
    const { beginPickBatch } = await import("./record-pick-scan");

    const result = await beginPickBatch("batch-1");

    expect(mockRpc).toHaveBeenCalledWith("begin_pick_batch", { p_batch_id: "batch-1" });
    expect(result).toEqual({ success: true });
  });

  it("surfaces an RPC error (e.g. the batch isn't pending)", async () => {
    mockRpc.mockResolvedValue({
      error: { message: "begin_pick_batch: batch batch-1 is completed, not pending" },
    });
    const { beginPickBatch } = await import("./record-pick-scan");

    const result = await beginPickBatch("batch-1");

    expect(result).toEqual({
      success: false,
      error: "begin_pick_batch: batch batch-1 is completed, not pending",
    });
  });
});

describe("recordPickLineScan", () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it("calls record_pick_line_scan with the line id and default condition", async () => {
    mockRpc.mockResolvedValue({ error: null });
    const { recordPickLineScan } = await import("./record-pick-scan");

    const result = await recordPickLineScan("line-1");

    expect(mockRpc).toHaveBeenCalledWith("record_pick_line_scan", {
      p_pick_line_id: "line-1",
      p_condition_confirmed: "match",
    });
    expect(result).toEqual({ success: true });
  });

  it("passes through a degraded condition", async () => {
    mockRpc.mockResolvedValue({ error: null });
    const { recordPickLineScan } = await import("./record-pick-scan");

    await recordPickLineScan("line-1", "degraded");

    expect(mockRpc).toHaveBeenCalledWith("record_pick_line_scan", {
      p_pick_line_id: "line-1",
      p_condition_confirmed: "degraded",
    });
  });

  it("surfaces an RPC error (e.g. the line is already fully picked)", async () => {
    mockRpc.mockResolvedValue({
      error: { message: "record_pick_line_scan: pick line line-1 is already fully picked" },
    });
    const { recordPickLineScan } = await import("./record-pick-scan");

    const result = await recordPickLineScan("line-1");

    expect(result).toEqual({
      success: false,
      error: "record_pick_line_scan: pick line line-1 is already fully picked",
    });
  });
});

describe("completePickBatch", () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it("calls complete_pick_batch with the batch id", async () => {
    mockRpc.mockResolvedValue({ error: null });
    const { completePickBatch } = await import("./record-pick-scan");

    const result = await completePickBatch("batch-1");

    expect(mockRpc).toHaveBeenCalledWith("complete_pick_batch", { p_batch_id: "batch-1" });
    expect(result).toEqual({ success: true });
  });

  it("surfaces an RPC error (e.g. unpicked lines remain)", async () => {
    mockRpc.mockResolvedValue({
      error: { message: "complete_pick_batch: batch batch-1 still has unpicked lines" },
    });
    const { completePickBatch } = await import("./record-pick-scan");

    const result = await completePickBatch("batch-1");

    expect(result).toEqual({
      success: false,
      error: "complete_pick_batch: batch batch-1 still has unpicked lines",
    });
  });
});
