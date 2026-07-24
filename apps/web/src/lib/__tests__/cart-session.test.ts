import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGet = vi.fn();
const mockSet = vi.fn();
const mockDelete = vi.fn();

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: mockGet, set: mockSet, delete: mockDelete }),
}));

const mockMaybeSingle = vi.fn();
const mockLimit = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
const mockEqOnline = vi.fn().mockReturnValue({ limit: mockLimit });
const mockEqActive = vi.fn().mockReturnValue({ eq: mockEqOnline });
const mockSelect = vi.fn().mockReturnValue({ eq: mockEqActive });
const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });
const mockGetUser = vi.fn();
const mockRpc = vi.fn();

vi.mock("@/server/supabase", () => ({
  createServerSupabaseClient: () => ({
    from: mockFrom,
    auth: { getUser: mockGetUser },
    rpc: mockRpc,
  }),
}));

describe("getCartSessionId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the existing cookie value for returning guests", async () => {
    mockGet.mockReturnValue({ value: "existing-session-id" });
    const { getCartSessionId } = await import("../cart-session");

    const sessionId = await getCartSessionId();

    expect(sessionId).toBe("existing-session-id");
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("generates and persists a new session id (a real uuid) when none exists", async () => {
    mockGet.mockReturnValue(undefined);
    const { getCartSessionId } = await import("../cart-session");

    const sessionId = await getCartSessionId();

    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(mockSet).toHaveBeenCalledWith(
      "cart_session_id",
      sessionId,
      expect.objectContaining({ httpOnly: true, maxAge: 30 * 24 * 60 * 60, path: "/" }),
    );
  });
});

describe("resolveDefaultStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the first active store that accepts online orders", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { id: "store-1", organisation_id: "org-1" },
      error: null,
    });
    const { resolveDefaultStore } = await import("../cart-session");

    const store = await resolveDefaultStore();

    expect(mockFrom).toHaveBeenCalledWith("fulfilment_nodes");
    expect(store).toEqual({ id: "store-1", organisation_id: "org-1" });
  });

  it("returns null when no store accepts online orders", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    const { resolveDefaultStore } = await import("../cart-session");

    expect(await resolveDefaultStore()).toBeNull();
  });

  it("throws with the database error message on failure", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { resolveDefaultStore } = await import("../cart-session");

    await expect(resolveDefaultStore()).rejects.toThrow("Failed to resolve a store: boom");
  });
});

describe("getOrCreateCart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockReturnValue({ value: "session-id" });
  });

  it("uses the authenticated customer id instead of a guest token when signed in", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "customer-1" } } });
    mockRpc.mockResolvedValue({ data: { id: "cart-1" }, error: null });
    const { getOrCreateCart } = await import("../cart-session");

    const cart = await getOrCreateCart("org-1");

    expect(mockRpc).toHaveBeenCalledWith("get_or_create_cart", {
      p_organisation_id: "org-1",
      p_customer_id: "customer-1",
      p_guest_token: null,
    });
    expect(cart).toEqual({ id: "cart-1" });
  });

  it("passes the guest session cookie as the guest token when unauthenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    mockRpc.mockResolvedValue({ data: { id: "cart-1" }, error: null });
    const { getOrCreateCart } = await import("../cart-session");

    await getOrCreateCart("org-1");

    expect(mockRpc).toHaveBeenCalledWith("get_or_create_cart", {
      p_organisation_id: "org-1",
      p_customer_id: null,
      p_guest_token: "session-id",
    });
  });

  it("throws when the RPC fails", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { getOrCreateCart } = await import("../cart-session");

    await expect(getOrCreateCart("org-1")).rejects.toThrow("boom");
  });
});
