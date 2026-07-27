import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGet = vi.fn();
const mockSet = vi.fn();
const mockDelete = vi.fn();

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: mockGet, set: mockSet, delete: mockDelete }),
}));

const mockFrom = vi.fn();
const mockGetUser = vi.fn();
const mockRpc = vi.fn();

vi.mock("@/server/supabase", () => ({
  createServerSupabaseClient: () => ({
    from: mockFrom,
    auth: { getUser: mockGetUser },
    rpc: mockRpc,
  }),
}));

// Models supabase-js's chainable query builder generically enough to cover
// every shape resolveDefaultStore() issues against it: an arbitrary number
// of .eq() calls terminating in either .maybeSingle() directly (the
// preferred-store lookup) or .limit(n).maybeSingle() (the "first active
// store" fallback) -- both read from the same "fulfilment_nodes" table, so
// a single call-order-aware mockFrom queues one of these per expected call.
function chainable(response: { data: unknown; error: unknown }) {
  const node = {
    eq: () => node,
    maybeSingle: () => Promise.resolve(response),
    limit: () => ({ maybeSingle: () => Promise.resolve(response) }),
  };
  return { select: () => node };
}

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

describe("getPreferredStoreCookie / setPreferredStoreCookie", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no preferred-store cookie is set", async () => {
    mockGet.mockReturnValue(undefined);
    const { getPreferredStoreCookie } = await import("../cart-session");

    expect(await getPreferredStoreCookie()).toBeNull();
  });

  it("returns the cookie value when one is set", async () => {
    mockGet.mockReturnValue({ value: "store-1" });
    const { getPreferredStoreCookie } = await import("../cart-session");

    expect(await getPreferredStoreCookie()).toBe("store-1");
  });

  it("sets a long-lived, httpOnly preferred-store cookie", async () => {
    const { setPreferredStoreCookie } = await import("../cart-session");

    await setPreferredStoreCookie("store-1");

    expect(mockSet).toHaveBeenCalledWith(
      "preferred_store_id",
      "store-1",
      expect.objectContaining({ httpOnly: true, maxAge: 180 * 24 * 60 * 60, path: "/" }),
    );
  });
});

describe("resolveDefaultStore", () => {
  const DEFAULT_STORE = { id: "store-default", organisation_id: "org-1" };
  const PREFERRED_STORE = { id: "store-preferred", organisation_id: "org-1" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the first active store that accepts online orders for a guest with no preference cookie", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    mockGet.mockReturnValue(undefined);
    mockFrom.mockImplementationOnce(() => chainable({ data: DEFAULT_STORE, error: null }));
    const { resolveDefaultStore } = await import("../cart-session");

    const store = await resolveDefaultStore();

    expect(mockFrom).toHaveBeenCalledWith("fulfilment_nodes");
    expect(store).toEqual(DEFAULT_STORE);
  });

  it("returns null when no store accepts online orders", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    mockGet.mockReturnValue(undefined);
    mockFrom.mockImplementationOnce(() => chainable({ data: null, error: null }));
    const { resolveDefaultStore } = await import("../cart-session");

    expect(await resolveDefaultStore()).toBeNull();
  });

  it("throws with the database error message when the fallback lookup fails", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    mockGet.mockReturnValue(undefined);
    mockFrom.mockImplementationOnce(() => chainable({ data: null, error: { message: "boom" } }));
    const { resolveDefaultStore } = await import("../cart-session");

    await expect(resolveDefaultStore()).rejects.toThrow("Failed to resolve a store: boom");
  });

  it("uses an authenticated customer's preferred store instead of the default", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "customer-1" } } });
    mockFrom
      .mockImplementationOnce(() =>
        chainable({ data: { preferred_fulfilment_node_id: "store-preferred" }, error: null }),
      )
      .mockImplementationOnce(() => chainable({ data: PREFERRED_STORE, error: null }));
    const { resolveDefaultStore } = await import("../cart-session");

    const store = await resolveDefaultStore();

    expect(mockFrom).toHaveBeenNthCalledWith(1, "profiles");
    expect(mockFrom).toHaveBeenNthCalledWith(2, "fulfilment_nodes");
    expect(mockFrom).toHaveBeenCalledTimes(2);
    expect(store).toEqual(PREFERRED_STORE);
  });

  it("falls back to the default store when the customer's preferred store is no longer active/online", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "customer-1" } } });
    mockFrom
      .mockImplementationOnce(() =>
        chainable({ data: { preferred_fulfilment_node_id: "store-inactive" }, error: null }),
      )
      .mockImplementationOnce(() => chainable({ data: null, error: null }))
      .mockImplementationOnce(() => chainable({ data: DEFAULT_STORE, error: null }));
    const { resolveDefaultStore } = await import("../cart-session");

    const store = await resolveDefaultStore();

    expect(mockFrom).toHaveBeenCalledTimes(3);
    expect(store).toEqual(DEFAULT_STORE);
  });

  it("uses a guest's preferred-store cookie instead of the default", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    mockGet.mockReturnValue({ value: "store-preferred" });
    mockFrom.mockImplementationOnce(() => chainable({ data: PREFERRED_STORE, error: null }));
    const { resolveDefaultStore } = await import("../cart-session");

    const store = await resolveDefaultStore();

    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalledWith("fulfilment_nodes");
    expect(store).toEqual(PREFERRED_STORE);
  });

  it("falls back to the default store when the guest's preferred-store cookie no longer names an active/online store", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    mockGet.mockReturnValue({ value: "store-closed" });
    mockFrom
      .mockImplementationOnce(() => chainable({ data: null, error: null }))
      .mockImplementationOnce(() => chainable({ data: DEFAULT_STORE, error: null }));
    const { resolveDefaultStore } = await import("../cart-session");

    const store = await resolveDefaultStore();

    expect(store).toEqual(DEFAULT_STORE);
  });

  it("throws with the database error message when the preferred-store lookup itself fails", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "customer-1" } } });
    mockFrom
      .mockImplementationOnce(() =>
        chainable({ data: { preferred_fulfilment_node_id: "store-preferred" }, error: null }),
      )
      .mockImplementationOnce(() => chainable({ data: null, error: { message: "boom" } }));
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
