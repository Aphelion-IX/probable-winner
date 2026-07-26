import { describe, expect, it, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockMaybeSingle = vi.fn();
const mockInsert = vi.fn();
const mockGetStaffContext = vi.fn();

vi.mock("@/server/supabase", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: mockGetUser },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: mockMaybeSingle }) }),
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

const USER = { id: "user-1", email: "player@example.com" };

function request(query: string) {
  return { url: `http://localhost:3000/auth/complete${query}` } as never;
}

function locationOf(response: Response): URL {
  return new URL(response.headers.get("location") ?? "");
}

describe("GET /auth/complete", () => {
  beforeEach(() => {
    mockGetUser.mockReset().mockResolvedValue({ data: { user: USER }, error: null });
    mockMaybeSingle.mockReset().mockResolvedValue({ data: { display_name: "Jo" } });
    mockInsert.mockReset().mockResolvedValue({ error: null });
    mockGetStaffContext.mockReset().mockResolvedValue(null);
  });

  it("sends an established customer to their account", async () => {
    const response = await GET(request(""));

    expect(locationOf(response).pathname).toBe("/account");
  });

  it("sends an established staff member to the staff portal", async () => {
    mockGetStaffContext.mockResolvedValue({ roleCode: "store_manager" });

    const response = await GET(request(""));

    expect(locationOf(response).pathname).toBe("/staff/dashboard");
  });

  it("honours a safe return path", async () => {
    const response = await GET(request("?next=%2Faccount%2Forders"));

    expect(locationOf(response).pathname).toBe("/account/orders");
  });

  it("refuses an off-origin return path", async () => {
    const response = await GET(request("?next=https%3A%2F%2Fevil.example"));

    const location = locationOf(response);
    expect(location.origin).toBe("http://localhost:3000");
    expect(location.pathname).toBe("/account");
  });

  it("refuses a protocol-relative return path", async () => {
    const response = await GET(request("?next=%2F%2Fevil.example"));

    expect(locationOf(response).origin).toBe("http://localhost:3000");
  });

  it("does not treat arriving at this URL as proof of a session", async () => {
    // Anyone can type /auth/complete; only getUser() decides.
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await GET(request(""));
    const location = locationOf(response);

    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("error")).toContain("did not complete");
  });

  it("preserves the return path when sending the user back to login", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await GET(request("?next=%2Faccount%2Forders"));

    expect(locationOf(response).searchParams.get("next")).toBe("/account/orders");
  });

  it("sends a first-time user through profile setup", async () => {
    // Email sign-in never supplies a name, so every new account lands here.
    mockMaybeSingle.mockResolvedValue({ data: null });

    const response = await GET(request(""));

    expect(mockInsert).toHaveBeenCalledWith({ id: "user-1", display_name: null });
    expect(locationOf(response).pathname).toBe("/account/setup");
  });

  it("carries the return path into profile setup", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null });

    const response = await GET(request("?next=%2Faccount%2Forders"));
    const location = locationOf(response);

    expect(location.pathname).toBe("/account/setup");
    expect(location.searchParams.get("next")).toBe("/account/orders");
  });

  it("sends a user with a blank display name through setup", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { display_name: "   " } });

    const response = await GET(request(""));

    expect(locationOf(response).pathname).toBe("/account/setup");
  });

  it("does not overwrite an existing profile", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { display_name: "Chosen Name" } });

    const response = await GET(request(""));

    expect(mockInsert).not.toHaveBeenCalled();
    expect(locationOf(response).pathname).toBe("/account");
  });

  it("treats a duplicate profile insert as success, not failure", async () => {
    // The handle_new_customer() trigger won the race — a normal outcome.
    mockMaybeSingle.mockResolvedValue({ data: null });
    mockInsert.mockResolvedValue({ error: { code: "23505", message: "duplicate key" } });

    const response = await GET(request(""));

    expect(locationOf(response).pathname).toBe("/account/setup");
  });

  it("grants no staff access without a staff_memberships row", async () => {
    mockGetStaffContext.mockResolvedValue(null);

    const response = await GET(request(""));

    expect(locationOf(response).pathname).toBe("/account");
  });
});
