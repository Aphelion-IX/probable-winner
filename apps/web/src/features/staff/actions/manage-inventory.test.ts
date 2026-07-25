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
  roleCode: "store_manager",
  permissions: ["inventory.view", "inventory.adjust"],
  nodeId: "node-1",
  nodeIds: ["node-1", "node-2"],
  scopeType: "selected_stores",
};

const VALID_ADJUSTMENT = {
  nodeId: "node-1",
  skuId: "sku-1",
  movementType: "stocktake_adjustment" as const,
  quantityDelta: -3,
  reason: "Recount after event",
};

describe("adjustStock", () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockGetStaffContext.mockReset();
  });

  it("calls adjust_inventory with the supplied correction", async () => {
    mockGetStaffContext.mockResolvedValue(STAFF);
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { adjustStock } = await import("./manage-inventory");

    const result = await adjustStock(VALID_ADJUSTMENT);

    expect(result).toEqual({ success: true });
    expect(mockRpc).toHaveBeenCalledWith("adjust_inventory", {
      p_fulfilment_node_id: "node-1",
      p_sellable_sku_id: "sku-1",
      p_movement_type: "stocktake_adjustment",
      p_quantity_delta: -3,
      p_reason: "Recount after event",
    });
  });

  it("refuses a node outside the staff member's scope without calling the RPC", async () => {
    mockGetStaffContext.mockResolvedValue(STAFF);
    const { adjustStock } = await import("./manage-inventory");

    const result = await adjustStock({ ...VALID_ADJUSTMENT, nodeId: "node-99" });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/outside your scope/);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("refuses when the role lacks inventory.adjust", async () => {
    mockGetStaffContext.mockResolvedValue({ ...STAFF, permissions: ["inventory.view"] });
    const { adjustStock } = await import("./manage-inventory");

    const result = await adjustStock(VALID_ADJUSTMENT);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/inventory\.adjust/);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects a movement type that is not a hand adjustment", async () => {
    mockGetStaffContext.mockResolvedValue(STAFF);
    const { adjustStock } = await import("./manage-inventory");

    // 'sale' is a real inventory_movements type, but one only the order
    // pipeline may write — a form must not be able to book one.
    const result = await adjustStock({
      ...VALID_ADJUSTMENT,
      movementType: "sale" as unknown as typeof VALID_ADJUSTMENT.movementType,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Unsupported adjustment type/);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects a zero or fractional delta", async () => {
    mockGetStaffContext.mockResolvedValue(STAFF);
    const { adjustStock } = await import("./manage-inventory");

    expect((await adjustStock({ ...VALID_ADJUSTMENT, quantityDelta: 0 })).success).toBe(false);
    expect((await adjustStock({ ...VALID_ADJUSTMENT, quantityDelta: 1.5 })).success).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("requires a reason", async () => {
    mockGetStaffContext.mockResolvedValue(STAFF);
    const { adjustStock } = await import("./manage-inventory");

    const result = await adjustStock({ ...VALID_ADJUSTMENT, reason: "   " });

    expect(result.success).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("surfaces a database error rather than reporting success", async () => {
    mockGetStaffContext.mockResolvedValue(STAFF);
    mockRpc.mockResolvedValue({ data: null, error: { message: "insufficient stock" } });
    const { adjustStock } = await import("./manage-inventory");

    const result = await adjustStock(VALID_ADJUSTMENT);

    expect(result).toEqual({ success: false, error: "insufficient stock" });
  });

  it("returns an error without calling the RPC when there is no staff session", async () => {
    mockGetStaffContext.mockResolvedValue(null);
    const { adjustStock } = await import("./manage-inventory");

    const result = await adjustStock(VALID_ADJUSTMENT);

    expect(result).toEqual({ success: false, error: "Not authenticated as staff" });
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe("quarantineStock", () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockGetStaffContext.mockReset();
  });

  it("calls quarantine_inventory with a trimmed reason", async () => {
    mockGetStaffContext.mockResolvedValue(STAFF);
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { quarantineStock } = await import("./manage-inventory");

    const result = await quarantineStock({
      nodeId: "node-2",
      skuId: "sku-9",
      quantity: 4,
      reason: "  water damage  ",
    });

    expect(result).toEqual({ success: true });
    expect(mockRpc).toHaveBeenCalledWith("quarantine_inventory", {
      p_fulfilment_node_id: "node-2",
      p_sellable_sku_id: "sku-9",
      p_quantity: 4,
      p_reason: "water damage",
    });
  });

  it("rejects a non-positive quantity", async () => {
    mockGetStaffContext.mockResolvedValue(STAFF);
    const { quarantineStock } = await import("./manage-inventory");

    const result = await quarantineStock({
      nodeId: "node-1",
      skuId: "sku-1",
      quantity: 0,
      reason: "damage",
    });

    expect(result.success).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe("releaseQuarantine", () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockGetStaffContext.mockReset();
  });

  it("calls release_inventory_quarantine for a permitted staff member", async () => {
    mockGetStaffContext.mockResolvedValue(STAFF);
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { releaseQuarantine } = await import("./manage-inventory");

    const result = await releaseQuarantine("quarantine-1");

    expect(result).toEqual({ success: true });
    expect(mockRpc).toHaveBeenCalledWith("release_inventory_quarantine", {
      p_quarantine_id: "quarantine-1",
    });
  });

  it("refuses without inventory.adjust", async () => {
    mockGetStaffContext.mockResolvedValue({ ...STAFF, permissions: [] });
    const { releaseQuarantine } = await import("./manage-inventory");

    const result = await releaseQuarantine("quarantine-1");

    expect(result.success).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
