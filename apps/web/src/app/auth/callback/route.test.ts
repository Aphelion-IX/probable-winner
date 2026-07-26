import { describe, expect, it, vi, beforeEach } from "vitest";

const mockExchange = vi.fn();
const mockGetUser = vi.fn();
const mockMaybeSingle = vi.fn();
const mockInsert = vi.fn();
const mockGetStaffContext = vi.fn();

vi.mock("@/server/supabase", () => ({
  createServerSupabaseClient: async () => ({
    auth: {
      exchangeCodeForSession: mockExchange,
      getUser: mockGetUser,
    },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: mockMaybeSingle }),
      }),
      insert: mockInsert,
    }),
  }),
}));

vi.mock("@/server/staff-context", () => ({ getStaffContext: mockGetStaffContext }));

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), serializeError: (e: unknown) => e },
  getRequestId: async () => "test-request",
}));

const { GET } = await import("./route");

const USER = { id: "user-1", email: "player@example.com", user_metadata: {} };

function request(query: string) {
  return { url: `http://localhost:3000/auth/callback${query}` } as never;
}

function locationOf(response: Response): URL {
  return new URL(response.headers.get("location") ?? "");
}

describe("GET /auth/callback", () => {
  beforeEach(() => {
    mockExchange.mockReset().mockResolvedValue({ error: null });
    mockGetUser.mockReset().mockResolvedValue({ data: { user: USER }, error: null });
    mockMaybeSingle.mockReset().mockResolvedValue({ data: { display_name: "Jo" } });
    mockInsert.mockReset().mockResolvedValue({ error: null });
    mockGetStaffContext.mockReset().mockResolvedValue(null);
  });

  it("sends a completed customer sign-in to their account", async () => {
    const response = await GET(request("?code=abc"));

    expect(mockExchange).toHaveBeenCalledWith("abc");
    expect(locationOf(response).pathname).toBe("/account");
  });

  it("sends a completed staff sign-in to the staff portal", async () => {
    mockGetStaffContext.mockResolvedValue({ roleCode: "store_manager" });

    const response = await GET(request("?code=abc"));

    expect(locationOf(response).pathname).toBe("/staff/dashboard");
  });

  it("honours a safe return path", async () => {
    const response = await GET(request("?code=abc&next=%2Faccount%2Forders"));

    expect(locationOf(response).pathname).toBe("/account/orders");
  });

  it("refuses an off-origin return path", async () => {
    const response = await GET(request("?code=abc&next=https%3A%2F%2Fevil.example"));

    const location = locationOf(response);
    expect(location.origin).toBe("http://localhost:3000");
    expect(location.pathname).toBe("/account");
  });

  it("refuses a protocol-relative return path", async () => {
    const response = await GET(request("?code=abc&next=%2F%2Fevil.example"));

    expect(locationOf(response).origin).toBe("http://localhost:3000");
  });

  it("does not verify the session from the URL alone", async () => {
    // A `code` in the query string proves only that the browser arrived.
    mockExchange.mockResolvedValue({ error: { message: "invalid code" } });

    const response = await GET(request("?code=forged"));
    const location = locationOf(response);

    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("error")).toContain("Could not complete sign-in");
  });

  it("fails closed when the exchange succeeds but no user can be resolved", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await GET(request("?code=abc"));

    expect(locationOf(response).pathname).toBe("/login");
  });

  it("reports a cancelled sign-in in plain language", async () => {
    const response = await GET(request("?error=access_denied"));
    const location = locationOf(response);

    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("error")).toBe("Sign-in was cancelled.");
    expect(mockExchange).not.toHaveBeenCalled();
  });

  it("returns to login when the provider sent no code", async () => {
    const response = await GET(request(""));

    expect(locationOf(response).pathname).toBe("/login");
    expect(mockExchange).not.toHaveBeenCalled();
  });

  it("preserves the return path through an error so the user is not lost", async () => {
    const response = await GET(request("?error=access_denied&next=%2Faccount%2Forders"));

    expect(locationOf(response).searchParams.get("next")).toBe("/account/orders");
  });

  it("does not overwrite an existing profile", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { display_name: "Chosen Name" } });

    const response = await GET(request("?code=abc"));

    // No insert, and no redirect to setup: the user already has a name.
    expect(mockInsert).not.toHaveBeenCalled();
    expect(locationOf(response).pathname).toBe("/account");
  });

  it("creates a profile when none exists, seeded from provider metadata", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null });
    mockGetUser.mockResolvedValue({
      data: { user: { ...USER, user_metadata: { full_name: "Ada Lovelace" } } },
      error: null,
    });

    const response = await GET(request("?code=abc"));

    expect(mockInsert).toHaveBeenCalledWith({ id: "user-1", display_name: "Ada Lovelace" });
    expect(locationOf(response).pathname).toBe("/account");
  });

  it("sends an Apple user with no supplied name through profile setup", async () => {
    // Apple returns a name only on first authorisation, and users may decline.
    mockMaybeSingle.mockResolvedValue({ data: null });
    mockGetUser.mockResolvedValue({
      data: { user: { ...USER, user_metadata: {} } },
      error: null,
    });

    const response = await GET(request("?code=abc"));

    expect(mockInsert).toHaveBeenCalledWith({ id: "user-1", display_name: null });
    expect(locationOf(response).pathname).toBe("/account/setup");
  });

  it("carries the return path into profile setup", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null });

    const response = await GET(request("?code=abc&next=%2Faccount%2Forders"));
    const location = locationOf(response);

    expect(location.pathname).toBe("/account/setup");
    expect(location.searchParams.get("next")).toBe("/account/orders");
  });

  it("treats a duplicate profile insert as success, not failure", async () => {
    // The handle_new_customer() trigger won the race — that is a normal
    // outcome, not an error to bounce the user for.
    mockMaybeSingle.mockResolvedValue({ data: null });
    mockInsert.mockResolvedValue({ error: { code: "23505", message: "duplicate key" } });

    const response = await GET(request("?code=abc"));

    expect(locationOf(response).pathname).toBe("/account/setup");
  });

  it("never grants staff access from provider metadata", async () => {
    // A hostile or careless provider claim must not reach the staff portal:
    // only staff_memberships decides, and here it says no.
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          ...USER,
          user_metadata: { role: "admin", is_admin: true, app_role: "system_admin" },
        },
      },
      error: null,
    });
    mockGetStaffContext.mockResolvedValue(null);

    const response = await GET(request("?code=abc"));

    expect(locationOf(response).pathname).toBe("/account");
  });
});
