import { describe, expect, it, vi, beforeEach } from "vitest";

const mockReturns = vi.fn();
const mockOrder = vi.fn().mockReturnValue({ returns: mockReturns });
const mockEq = vi.fn().mockReturnValue({ order: mockOrder });
const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });
const mockCreatePublicSupabaseClient = vi.fn();
const mockCreateServerSupabaseClient = vi.fn();

vi.mock("@/server/supabase", () => ({
  createPublicSupabaseClient: (...args: unknown[]) => mockCreatePublicSupabaseClient(...args),
  createServerSupabaseClient: (...args: unknown[]) => mockCreateServerSupabaseClient(...args),
}));

vi.mock("next/cache", () => ({
  // Runs the wrapped function directly -- the whole point of this test is
  // to prove nothing in that function needs cookies(), so no unstable_cache
  // simulation is needed here.
  unstable_cache: (fn: () => unknown) => fn,
}));

const STORES = [{ id: "store-1", name: "Geelong", code: "STR-01", region: "VIC" }];

describe("listActiveStores", () => {
  beforeEach(() => {
    mockCreatePublicSupabaseClient.mockReset();
    mockCreateServerSupabaseClient.mockReset();
    mockCreatePublicSupabaseClient.mockReturnValue({ from: mockFrom });
    mockReturns.mockResolvedValue({ data: STORES, error: null });
  });

  it("uses the cookie-free public client, not the session-aware one", async () => {
    const { listActiveStores } = await import("./list-active-stores");

    const stores = await listActiveStores();

    expect(stores).toEqual(STORES);
    expect(mockCreatePublicSupabaseClient).toHaveBeenCalled();
    expect(mockCreateServerSupabaseClient).not.toHaveBeenCalled();
    expect(mockFrom).toHaveBeenCalledWith("fulfilment_nodes");
    expect(mockEq).toHaveBeenCalledWith("active", true);
  });

  it("throws with the database error message on failure", async () => {
    mockReturns.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { listActiveStores } = await import("./list-active-stores");

    await expect(listActiveStores()).rejects.toThrow("Failed to list stores: boom");
  });
});
