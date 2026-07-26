import { describe, expect, it, vi, beforeEach } from "vitest";

const mockSignInWithOAuth = vi.fn();

vi.mock("@/lib/supabase-browser", () => ({
  createBrowserSupabaseClient: () => ({
    auth: { signInWithOAuth: mockSignInWithOAuth },
  }),
}));

const { signInWithOAuth, oauthErrorMessage } = await import("./sign-in-with-oauth");

describe("signInWithOAuth", () => {
  beforeEach(() => {
    mockSignInWithOAuth.mockReset();
    mockSignInWithOAuth.mockResolvedValue({ error: null });
  });

  it("starts the Google flow with the callback redirect", async () => {
    await signInWithOAuth("google");

    expect(mockSignInWithOAuth).toHaveBeenCalledTimes(1);
    expect(mockSignInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  });

  it("starts the Apple flow with the callback redirect", async () => {
    await signInWithOAuth("apple");

    expect(mockSignInWithOAuth).toHaveBeenCalledWith({
      provider: "apple",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  });

  it("forwards a safe return path as ?next", async () => {
    await signInWithOAuth("google", "/account/orders");

    const [[call]] = mockSignInWithOAuth.mock.calls;
    const redirectTo = new URL(call.options.redirectTo);

    expect(redirectTo.pathname).toBe("/auth/callback");
    expect(redirectTo.searchParams.get("next")).toBe("/account/orders");
  });

  it("does not forward an off-origin return path", async () => {
    // The hostile value must not survive the round trip; it degrades to the
    // safe default rather than being handed to the provider.
    await signInWithOAuth("google", "https://evil.example");

    const [[call]] = mockSignInWithOAuth.mock.calls;
    const redirectTo = new URL(call.options.redirectTo);

    expect(redirectTo.searchParams.get("next")).toBe("/account");
    expect(call.options.redirectTo).not.toContain("evil.example");
  });

  it("always redirects to this origin's callback", async () => {
    await signInWithOAuth("apple", "/account");

    const [[call]] = mockSignInWithOAuth.mock.calls;
    expect(new URL(call.options.redirectTo).origin).toBe(window.location.origin);
  });

  it("throws a readable message when Supabase reports an error", async () => {
    mockSignInWithOAuth.mockResolvedValue({ error: { message: "Provider is disabled" } });

    await expect(signInWithOAuth("apple")).rejects.toThrow(
      "Could not start sign-in with Apple. Provider is disabled",
    );
  });
});

describe("oauthErrorMessage", () => {
  it("names the provider the user actually clicked", () => {
    expect(oauthErrorMessage("google")).toContain("Google");
    expect(oauthErrorMessage("apple")).toContain("Apple");
  });

  it("appends a short provider detail", () => {
    expect(oauthErrorMessage("google", "Network unreachable")).toBe(
      "Could not start sign-in with Google. Network unreachable",
    );
  });

  it("drops an unhelpfully long detail rather than dumping it on the user", () => {
    const wall = "x".repeat(300);
    expect(oauthErrorMessage("google", wall)).toBe(
      "Could not start sign-in with Google. Please try again.",
    );
  });
});
