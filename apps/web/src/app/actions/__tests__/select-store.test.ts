import { describe, expect, it, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockSetPreferredStoreCookie = vi.fn();

// Store lookup chain: .from("fulfilment_nodes").select().eq().eq().maybeSingle()
const mockStoreMaybeSingle = vi.fn();
const mockStoreEqOnline = vi.fn().mockReturnValue({ maybeSingle: mockStoreMaybeSingle });
const mockStoreEqActive = vi.fn().mockReturnValue({ eq: mockStoreEqOnline });
const mockStoreSelect = vi.fn().mockReturnValue({ eq: mockStoreEqActive });

// Profile update chain: .from("profiles").update().eq()
const mockProfileEq = vi.fn();
const mockProfileUpdate = vi.fn().mockReturnValue({ eq: mockProfileEq });

const mockFrom = vi.fn((table: string) => {
  if (table === "fulfilment_nodes") return { select: mockStoreSelect };
  if (table === "profiles") return { update: mockProfileUpdate };
  throw new Error(`unexpected table ${table}`);
});

vi.mock("@/server/supabase", () => ({
  createServerSupabaseClient: () => ({
    from: mockFrom,
    auth: { getUser: mockGetUser },
  }),
}));

vi.mock("@/lib/cart-session", () => ({
  setPreferredStoreCookie: (...args: unknown[]) => mockSetPreferredStoreCookie(...args),
}));

describe("selectPreferredStore", () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockSetPreferredStoreCookie.mockReset();
    mockStoreMaybeSingle.mockReset();
    mockProfileEq.mockReset();
    mockProfileUpdate.mockClear();
    mockStoreEqOnline.mockClear();
    mockStoreEqActive.mockClear();
  });

  it("returns an error without writing anything when the store isn't found or active", async () => {
    mockStoreMaybeSingle.mockResolvedValue({ data: null, error: null });
    const { selectPreferredStore } = await import("../select-store");

    const result = await selectPreferredStore("store-closed");

    expect(result).toEqual({ success: false, error: "That store is not currently active." });
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it("returns an error when the store lookup itself fails", async () => {
    mockStoreMaybeSingle.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { selectPreferredStore } = await import("../select-store");

    const result = await selectPreferredStore("store-1");

    expect(result).toEqual({ success: false, error: "boom" });
  });

  it("updates the authenticated customer's profile instead of setting a cookie", async () => {
    mockStoreMaybeSingle.mockResolvedValue({ data: { id: "store-1" }, error: null });
    mockGetUser.mockResolvedValue({ data: { user: { id: "customer-1" } } });
    mockProfileEq.mockResolvedValue({ error: null });
    const { selectPreferredStore } = await import("../select-store");

    const result = await selectPreferredStore("store-1");

    expect(result).toEqual({ success: true });
    expect(mockProfileUpdate).toHaveBeenCalledWith({ preferred_fulfilment_node_id: "store-1" });
    expect(mockProfileEq).toHaveBeenCalledWith("id", "customer-1");
    expect(mockSetPreferredStoreCookie).not.toHaveBeenCalled();
  });

  it("returns an error when the profile update fails", async () => {
    mockStoreMaybeSingle.mockResolvedValue({ data: { id: "store-1" }, error: null });
    mockGetUser.mockResolvedValue({ data: { user: { id: "customer-1" } } });
    mockProfileEq.mockResolvedValue({ error: { message: "profile write failed" } });
    const { selectPreferredStore } = await import("../select-store");

    const result = await selectPreferredStore("store-1");

    expect(result).toEqual({ success: false, error: "profile write failed" });
  });

  it("sets a cookie instead of updating a profile for a guest", async () => {
    mockStoreMaybeSingle.mockResolvedValue({ data: { id: "store-1" }, error: null });
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const { selectPreferredStore } = await import("../select-store");

    const result = await selectPreferredStore("store-1");

    expect(result).toEqual({ success: true });
    expect(mockSetPreferredStoreCookie).toHaveBeenCalledWith("store-1");
    expect(mockProfileUpdate).not.toHaveBeenCalled();
  });
});
