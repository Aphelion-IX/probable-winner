import { describe, expect, it, vi, beforeEach } from "vitest";

// Isolated in its own file so mocking @/server/supabase and
// @/server/staff-context works reliably -- same reasoning as
// manage-transfers.test.ts. Unlike manage-transfers.ts (all .rpc() calls),
// manage-stocktakes.ts drives the plain .from()...eq()...single() query
// builder directly (counting is ordinary staff data entry, not an atomic
// function -- see the file's own header), so the mock needs to be a
// chainable stand-in rather than a single vi.fn().
type QueryResult = { data?: unknown; error?: unknown };

function chainable(result: QueryResult) {
  const builder: Record<string, unknown> = {};
  const methods = ["select", "insert", "update", "eq", "gt", "order", "limit"];
  for (const method of methods) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  // Makes the builder itself awaitable for calls that never reach
  // .single()/.maybeSingle() (e.g. a bare `.insert([...])` or a filtered
  // `.update()...eq()` with no further chaining).
  builder.then = (resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

const mockFrom = vi.fn();
const mockGetStaffContext = vi.fn();

vi.mock("@/server/supabase", () => ({
  createServerSupabaseClient: () => ({ from: mockFrom }),
}));

vi.mock("@/server/staff-context", () => ({
  getStaffContext: () => mockGetStaffContext(),
}));

const STAFF = {
  userId: "user-1",
  organisationId: "org-1",
  roleCode: "inventory_manager",
  permissions: ["inventory.view", "inventory.stocktake"],
  nodeId: "node-1",
  nodeIds: ["node-1", "node-2"],
  scopeType: "selected_stores",
};

/** Configures mockFrom to return a fixed result per table name, since no
 * action in this file queries the same table twice within one call. */
function byTable(results: Record<string, QueryResult>) {
  mockFrom.mockImplementation((table: string) => chainable(results[table] ?? { data: null, error: null }));
}

describe("createStocktake", () => {
  beforeEach(() => {
    mockFrom.mockReset();
    mockGetStaffContext.mockReset();
  });

  it("snapshots on-hand balances into stocktake_lines", async () => {
    mockGetStaffContext.mockResolvedValue(STAFF);
    byTable({
      inventory_balances: {
        data: [
          { sellable_sku_id: "sku-1", quantity_on_hand: 5 },
          { sellable_sku_id: "sku-2", quantity_on_hand: 2 },
        ],
        error: null,
      },
      stocktakes: { data: { id: "stocktake-1" }, error: null },
      stocktake_lines: { data: null, error: null },
    });
    const { createStocktake } = await import("./manage-stocktakes");

    const result = await createStocktake({ nodeId: "node-1", notes: "Quarterly count" });

    expect(result).toEqual({ success: true, stocktakeId: "stocktake-1" });
    expect(mockFrom).toHaveBeenCalledWith("inventory_balances");
    expect(mockFrom).toHaveBeenCalledWith("stocktakes");
    expect(mockFrom).toHaveBeenCalledWith("stocktake_lines");
  });

  it("refuses a node outside the staff member's scope", async () => {
    mockGetStaffContext.mockResolvedValue(STAFF);
    const { createStocktake } = await import("./manage-stocktakes");

    const result = await createStocktake({ nodeId: "node-99" });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/outside your scope/);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("refuses without inventory.stocktake", async () => {
    mockGetStaffContext.mockResolvedValue({ ...STAFF, permissions: ["inventory.view"] });
    const { createStocktake } = await import("./manage-stocktakes");

    const result = await createStocktake({ nodeId: "node-1" });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/inventory\.stocktake/);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("refuses when the store has nothing on hand to count", async () => {
    mockGetStaffContext.mockResolvedValue(STAFF);
    byTable({ inventory_balances: { data: [], error: null } });
    const { createStocktake } = await import("./manage-stocktakes");

    const result = await createStocktake({ nodeId: "node-1" });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Nothing is on hand/);
  });
});

describe("updateLineCount", () => {
  beforeEach(() => {
    mockFrom.mockReset();
    mockGetStaffContext.mockReset();
  });

  it("saves a count and advances a draft stocktake to in_progress", async () => {
    mockGetStaffContext.mockResolvedValue(STAFF);
    byTable({
      stocktake_lines: { data: { stocktake_id: "stocktake-1" }, error: null },
      stocktakes: { data: null, error: null },
    });
    const { updateLineCount } = await import("./manage-stocktakes");

    const result = await updateLineCount("line-1", 4);

    expect(result).toEqual({ success: true, stocktakeId: "stocktake-1" });
  });

  it("allows clearing a count back to null", async () => {
    mockGetStaffContext.mockResolvedValue(STAFF);
    byTable({
      stocktake_lines: { data: { stocktake_id: "stocktake-1" }, error: null },
      stocktakes: { data: null, error: null },
    });
    const { updateLineCount } = await import("./manage-stocktakes");

    const result = await updateLineCount("line-1", null);

    expect(result.success).toBe(true);
  });

  it("rejects a negative or fractional count", async () => {
    mockGetStaffContext.mockResolvedValue(STAFF);
    const { updateLineCount } = await import("./manage-stocktakes");

    expect((await updateLineCount("line-1", -1)).success).toBe(false);
    expect((await updateLineCount("line-1", 1.5)).success).toBe(false);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("refuses without inventory.stocktake", async () => {
    mockGetStaffContext.mockResolvedValue({ ...STAFF, permissions: [] });
    const { updateLineCount } = await import("./manage-stocktakes");

    const result = await updateLineCount("line-1", 3);

    expect(result.success).toBe(false);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe("completeStocktake", () => {
  beforeEach(() => {
    mockFrom.mockReset();
    mockGetStaffContext.mockReset();
  });

  it("marks the stocktake completed", async () => {
    mockGetStaffContext.mockResolvedValue(STAFF);
    byTable({ stocktakes: { data: null, error: null } });
    const { completeStocktake } = await import("./manage-stocktakes");

    const result = await completeStocktake("stocktake-1");

    expect(result).toEqual({ success: true, stocktakeId: "stocktake-1" });
    expect(mockFrom).toHaveBeenCalledWith("stocktakes");
  });

  it("surfaces a database error", async () => {
    mockGetStaffContext.mockResolvedValue(STAFF);
    byTable({ stocktakes: { data: null, error: { message: "not found" } } });
    const { completeStocktake } = await import("./manage-stocktakes");

    const result = await completeStocktake("stocktake-1");

    expect(result).toEqual({ success: false, error: "not found" });
  });

  it("refuses without inventory.stocktake", async () => {
    mockGetStaffContext.mockResolvedValue({ ...STAFF, permissions: ["inventory.view"] });
    const { completeStocktake } = await import("./manage-stocktakes");

    const result = await completeStocktake("stocktake-1");

    expect(result.success).toBe(false);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("returns an error without querying when there is no staff session", async () => {
    mockGetStaffContext.mockResolvedValue(null);
    const { completeStocktake } = await import("./manage-stocktakes");

    const result = await completeStocktake("stocktake-1");

    expect(result).toEqual({ success: false, error: "Not authenticated as staff" });
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
