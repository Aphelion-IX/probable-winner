import { describe, expect, it, vi, beforeEach } from "vitest";

// Isolated in its own file so mocking @/server/supabase and
// @/server/staff-context works reliably -- same reasoning as
// manage-stocktakes.test.ts (chainable .from() mock for the plain reads;
// mockRpc for the adjust_store_credit() write).
type QueryResult = { data?: unknown; error?: unknown };

function chainable(result: QueryResult) {
  const builder: Record<string, unknown> = {};
  const methods = ["select", "eq", "order", "limit"];
  for (const method of methods) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.then = (resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

const mockFrom = vi.fn();
const mockRpc = vi.fn();
const mockGetStaffContext = vi.fn();

vi.mock("@/server/supabase", () => ({
  createServerSupabaseClient: () => ({ from: mockFrom, rpc: mockRpc }),
}));

vi.mock("@/server/staff-context", () => ({
  getStaffContext: () => mockGetStaffContext(),
}));

const STAFF = {
  userId: "user-1",
  organisationId: "org-1",
  roleCode: "store_manager",
  permissions: ["users.view", "customers.credit"],
  nodeId: "node-1",
  nodeIds: ["node-1", "node-2"],
  scopeType: "selected_stores",
};

function byTable(results: Record<string, QueryResult>) {
  mockFrom.mockImplementation((table: string) => chainable(results[table] ?? { data: null, error: null }));
}

describe("getStoreCreditAccount", () => {
  beforeEach(() => {
    mockFrom.mockReset();
    mockGetStaffContext.mockReset();
  });

  it("returns the account's balance and currency", async () => {
    mockGetStaffContext.mockResolvedValue(STAFF);
    byTable({ store_credit_accounts: { data: { balance: "17.50", currency: "AUD" }, error: null } });
    const { getStoreCreditAccount } = await import("./manage-store-credit");

    const result = await getStoreCreditAccount("customer-1");

    expect(result).toEqual({ balance: 17.5, currency: "AUD" });
  });

  it("returns a zero balance when the customer has no account yet", async () => {
    mockGetStaffContext.mockResolvedValue(STAFF);
    byTable({ store_credit_accounts: { data: null, error: null } });
    const { getStoreCreditAccount } = await import("./manage-store-credit");

    const result = await getStoreCreditAccount("customer-1");

    expect(result).toEqual({ balance: 0, currency: "AUD" });
  });

  it("returns a zero balance without querying when there is no staff session", async () => {
    mockGetStaffContext.mockResolvedValue(null);
    const { getStoreCreditAccount } = await import("./manage-store-credit");

    const result = await getStoreCreditAccount("customer-1");

    expect(result).toEqual({ balance: 0, currency: "AUD" });
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe("listStoreCreditLedger", () => {
  beforeEach(() => {
    mockFrom.mockReset();
    mockGetStaffContext.mockReset();
  });

  it("returns an empty list when the customer has no account", async () => {
    mockGetStaffContext.mockResolvedValue(STAFF);
    byTable({ store_credit_accounts: { data: null, error: null } });
    const { listStoreCreditLedger } = await import("./manage-store-credit");

    const result = await listStoreCreditLedger("customer-1");

    expect(result).toEqual([]);
    expect(mockFrom).toHaveBeenCalledWith("store_credit_accounts");
    expect(mockFrom).not.toHaveBeenCalledWith("store_credit_ledger");
  });

  it("maps ledger rows for an existing account", async () => {
    mockGetStaffContext.mockResolvedValue(STAFF);
    byTable({
      store_credit_accounts: { data: { id: "account-1" }, error: null },
      store_credit_ledger: {
        data: [
          {
            id: "entry-1",
            entry_type: "trade_in",
            amount_delta: "12.50",
            reason: "Trade-in",
            created_at: "2026-07-28T00:00:00Z",
          },
        ],
        error: null,
      },
    });
    const { listStoreCreditLedger } = await import("./manage-store-credit");

    const result = await listStoreCreditLedger("customer-1");

    expect(result).toEqual([
      {
        id: "entry-1",
        entryType: "trade_in",
        amountDelta: 12.5,
        reason: "Trade-in",
        createdAt: "2026-07-28T00:00:00Z",
      },
    ]);
  });
});

describe("adjustCustomerCredit", () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockGetStaffContext.mockReset();
  });

  it("calls adjust_store_credit with the supplied delta", async () => {
    mockGetStaffContext.mockResolvedValue(STAFF);
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { adjustCustomerCredit } = await import("./manage-store-credit");

    const result = await adjustCustomerCredit({
      customerId: "customer-1",
      amountDelta: 12.5,
      entryType: "trade_in",
      reason: "Trade-in: 5 bulk commons",
    });

    expect(result).toEqual({ success: true });
    expect(mockRpc).toHaveBeenCalledWith("adjust_store_credit", {
      p_customer_id: "customer-1",
      p_amount_delta: 12.5,
      p_entry_type: "trade_in",
      p_reason: "Trade-in: 5 bulk commons",
    });
  });

  it("passes a negative delta through unchanged for a removal", async () => {
    mockGetStaffContext.mockResolvedValue(STAFF);
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { adjustCustomerCredit } = await import("./manage-store-credit");

    await adjustCustomerCredit({
      customerId: "customer-1",
      amountDelta: -8,
      entryType: "redemption",
      reason: "Redeemed at checkout",
    });

    expect(mockRpc).toHaveBeenCalledWith(
      "adjust_store_credit",
      expect.objectContaining({ p_amount_delta: -8 }),
    );
  });

  it("refuses without customers.credit", async () => {
    mockGetStaffContext.mockResolvedValue({ ...STAFF, permissions: ["users.view"] });
    const { adjustCustomerCredit } = await import("./manage-store-credit");

    const result = await adjustCustomerCredit({
      customerId: "customer-1",
      amountDelta: 5,
      entryType: "goodwill",
      reason: "test",
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/customers\.credit/);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects a zero amount", async () => {
    mockGetStaffContext.mockResolvedValue(STAFF);
    const { adjustCustomerCredit } = await import("./manage-store-credit");

    const result = await adjustCustomerCredit({
      customerId: "customer-1",
      amountDelta: 0,
      entryType: "correction",
      reason: "test",
    });

    expect(result.success).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("requires a reason", async () => {
    mockGetStaffContext.mockResolvedValue(STAFF);
    const { adjustCustomerCredit } = await import("./manage-store-credit");

    const result = await adjustCustomerCredit({
      customerId: "customer-1",
      amountDelta: 5,
      entryType: "goodwill",
      reason: "   ",
    });

    expect(result.success).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("surfaces a database error, e.g. an over-redemption rejected by the balance check", async () => {
    mockGetStaffContext.mockResolvedValue(STAFF);
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "adjust_store_credit: insufficient store credit balance for customer ..." },
    });
    const { adjustCustomerCredit } = await import("./manage-store-credit");

    const result = await adjustCustomerCredit({
      customerId: "customer-1",
      amountDelta: -100,
      entryType: "redemption",
      reason: "over-redemption attempt",
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/insufficient store credit balance/);
  });

  it("returns an error without calling the RPC when there is no staff session", async () => {
    mockGetStaffContext.mockResolvedValue(null);
    const { adjustCustomerCredit } = await import("./manage-store-credit");

    const result = await adjustCustomerCredit({
      customerId: "customer-1",
      amountDelta: 5,
      entryType: "goodwill",
      reason: "test",
    });

    expect(result).toEqual({ success: false, error: "Not authenticated as staff" });
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
