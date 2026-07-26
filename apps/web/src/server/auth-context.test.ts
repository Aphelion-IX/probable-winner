import { describe, expect, it, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockMaybeSingle = vi.fn();
const mockGetStaffContext = vi.fn();
const mockHeaderGet = vi.fn();

vi.mock("./supabase", () => ({
  createServerSupabaseClient: () => ({
    auth: { getUser: mockGetUser },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: mockMaybeSingle }),
      }),
    }),
  }),
}));

vi.mock("./staff-context", () => ({
  getStaffContext: mockGetStaffContext,
}));

vi.mock("next/headers", () => ({
  headers: async () => ({ get: mockHeaderGet }),
}));

// redirect() throws in Next so control never continues past it. Mirroring
// that here is what lets the tests assert "the guard stopped rendering",
// not merely "the guard called something".
class RedirectError extends Error {
  constructor(public destination: string) {
    super(`REDIRECT:${destination}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (destination: string) => {
    throw new RedirectError(destination);
  },
}));

const { getAuthContext, requireUser, requireStaff, destinationFor, redirectIfSignedIn } =
  await import("./auth-context");

const CUSTOMER = { id: "user-1", email: "player@example.com", user_metadata: {} };

const STAFF_CONTEXT = {
  userId: "user-1",
  organisationId: "org-1",
  roleCode: "store_manager",
  permissions: ["orders.view", "inventory.adjust"],
  nodeId: "node-1",
  nodeIds: ["node-1"],
  scopeType: "store",
};

function signedIn(displayName: string | null = "Jo") {
  mockGetUser.mockResolvedValue({ data: { user: CUSTOMER } });
  mockMaybeSingle.mockResolvedValue({ data: { display_name: displayName } });
}

function signedOut() {
  mockGetUser.mockResolvedValue({ data: { user: null } });
}

describe("auth-context", () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockMaybeSingle.mockReset();
    mockGetStaffContext.mockReset();
    mockHeaderGet.mockReset();
    mockGetStaffContext.mockResolvedValue(null);
    mockHeaderGet.mockReturnValue("/account/orders");
  });

  describe("getAuthContext", () => {
    it("returns null when there is no session", async () => {
      signedOut();
      expect(await getAuthContext()).toBeNull();
    });

    it("gives a newly signed-in user no staff access by default", async () => {
      signedIn();
      mockGetStaffContext.mockResolvedValue(null);

      const context = await getAuthContext();

      // Simply having an account must never confer internal access.
      expect(context?.staff).toBeNull();
    });

    it("resolves staff access from the database membership, not the session", async () => {
      signedIn();
      mockGetStaffContext.mockResolvedValue(STAFF_CONTEXT);

      const context = await getAuthContext();

      expect(context?.staff?.roleCode).toBe("store_manager");
    });

    it("flags profile setup when the profile row is missing", async () => {
      mockGetUser.mockResolvedValue({ data: { user: CUSTOMER } });
      mockMaybeSingle.mockResolvedValue({ data: null });

      expect((await getAuthContext())?.needsProfileSetup).toBe(true);
    });

    it("flags profile setup when no display name was supplied", async () => {
      // Email sign-in supplies only an address, so this is the normal path
      // for every new account rather than an edge case.
      signedIn(null);
      expect((await getAuthContext())?.needsProfileSetup).toBe(true);
    });

    it("treats a whitespace-only display name as unset", async () => {
      signedIn("   ");
      expect((await getAuthContext())?.needsProfileSetup).toBe(true);
    });

    it("does not ask an established user to set up again", async () => {
      signedIn("Jo");
      expect((await getAuthContext())?.needsProfileSetup).toBe(false);
    });
  });

  describe("requireUser", () => {
    it("sends an unauthenticated visitor to login with a return path", async () => {
      signedOut();

      await expect(requireUser("/account/orders")).rejects.toMatchObject({
        destination: "/login?next=%2Faccount%2Forders",
      });
    });

    it("refuses to echo an unsafe return path into the login URL", async () => {
      signedOut();

      await expect(requireUser("https://evil.example")).rejects.toMatchObject({
        destination: "/login?next=%2Faccount",
      });
    });

    it("lets a signed-in user through", async () => {
      signedIn();
      await expect(requireUser("/account")).resolves.toMatchObject({ userId: "user-1" });
    });
  });

  describe("requireStaff", () => {
    it("sends a signed-out visitor to login", async () => {
      signedOut();
      mockHeaderGet.mockReturnValue("/staff/inventory");

      await expect(requireStaff()).rejects.toMatchObject({
        destination: "/login?next=%2Fstaff%2Finventory",
      });
    });

    it("turns an ordinary signed-in customer away from the staff portal", async () => {
      signedIn();
      mockGetStaffContext.mockResolvedValue(null);

      // Home, not login: they are authenticated, just not authorised.
      await expect(requireStaff()).rejects.toMatchObject({ destination: "/" });
    });

    it("admits a staff member with no specific permission required", async () => {
      signedIn();
      mockGetStaffContext.mockResolvedValue(STAFF_CONTEXT);

      await expect(requireStaff()).resolves.toMatchObject({
        staff: { roleCode: "store_manager" },
      });
    });

    it("admits a staff member holding the required permission", async () => {
      signedIn();
      mockGetStaffContext.mockResolvedValue(STAFF_CONTEXT);

      await expect(requireStaff("inventory.adjust")).resolves.toMatchObject({
        staff: { roleCode: "store_manager" },
      });
    });

    it("refuses a staff member who lacks the required permission", async () => {
      signedIn();
      mockGetStaffContext.mockResolvedValue(STAFF_CONTEXT);

      // store_manager has no pricing.override grant.
      await expect(requireStaff("pricing.override")).rejects.toMatchObject({
        destination: "/staff/dashboard?denied=1",
      });
    });

    it("locks out a user whose staff role has been removed", async () => {
      // Same signed-in user, membership now gone: access must end as soon as
      // the database says so, without waiting for the session to expire.
      signedIn();
      mockGetStaffContext.mockResolvedValue(null);

      await expect(requireStaff("orders.view")).rejects.toMatchObject({ destination: "/" });
    });
  });

  describe("destinationFor", () => {
    const customer = {
      userId: "user-1",
      email: null,
      displayName: "Jo",
      needsProfileSetup: false,
      staff: null,
    };

    it("prefers an explicit safe destination", () => {
      expect(destinationFor(customer, "/search?q=bolt")).toBe("/search?q=bolt");
    });

    it("ignores an unsafe destination and falls back by role", () => {
      expect(destinationFor(customer, "//evil.example")).toBe("/account");
    });

    it("sends a customer to their account", () => {
      expect(destinationFor(customer)).toBe("/account");
    });

    it("sends staff to the portal", () => {
      expect(destinationFor({ ...customer, staff: STAFF_CONTEXT })).toBe("/staff/dashboard");
    });
  });

  describe("redirectIfSignedIn", () => {
    it("does nothing for a guest", async () => {
      signedOut();
      await expect(redirectIfSignedIn("/account")).resolves.toBeUndefined();
    });

    it("routes an already-signed-in user onward", async () => {
      signedIn("Jo");

      await expect(redirectIfSignedIn("/account/orders")).rejects.toMatchObject({
        destination: "/account/orders",
      });
    });

    it("routes a user who has not finished setup to setup first", async () => {
      signedIn(null);

      await expect(redirectIfSignedIn("/account/orders")).rejects.toMatchObject({
        destination: "/account/setup?next=%2Faccount%2Forders",
      });
    });
  });
});
