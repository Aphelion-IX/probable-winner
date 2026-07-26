import { describe, expect, it, vi, beforeEach } from "vitest";

const mockSignInWithOtp = vi.fn();
const mockVerifyOtp = vi.fn();

vi.mock("@/lib/supabase-browser", () => ({
  createBrowserSupabaseClient: () => ({
    auth: { signInWithOtp: mockSignInWithOtp, verifyOtp: mockVerifyOtp },
  }),
}));

const { sendEmailOtp, verifyEmailOtp, emailOtpErrorMessage } = await import("./sign-in-with-email");

describe("sendEmailOtp", () => {
  beforeEach(() => {
    mockSignInWithOtp.mockReset().mockResolvedValue({ error: null });
  });

  it("requests a code for the given address", async () => {
    await sendEmailOtp("player@example.com");

    expect(mockSignInWithOtp).toHaveBeenCalledWith({ email: "player@example.com" });
  });

  it("trims surrounding whitespace", async () => {
    await sendEmailOtp("  player@example.com  ");

    expect(mockSignInWithOtp).toHaveBeenCalledWith({ email: "player@example.com" });
  });

  it("does not disable signup, so a first-time address creates an account", async () => {
    await sendEmailOtp("newcomer@example.com");

    const [[call]] = mockSignInWithOtp.mock.calls;
    expect(call.options?.shouldCreateUser).toBeUndefined();
  });

  it("throws a readable message when sending fails", async () => {
    mockSignInWithOtp.mockResolvedValue({ error: { message: "SMTP unavailable" } });

    await expect(sendEmailOtp("player@example.com")).rejects.toThrow(
      "Could not send your sign-in code. SMTP unavailable",
    );
  });
});

describe("verifyEmailOtp", () => {
  beforeEach(() => {
    mockVerifyOtp.mockReset().mockResolvedValue({ error: null });
  });

  it("verifies the code against the address", async () => {
    await verifyEmailOtp("player@example.com", "123456");

    expect(mockVerifyOtp).toHaveBeenCalledWith({
      email: "player@example.com",
      token: "123456",
      type: "email",
    });
  });

  it("throws a readable message for a wrong or expired code", async () => {
    mockVerifyOtp.mockResolvedValue({ error: { message: "Token has expired or is invalid" } });

    await expect(verifyEmailOtp("player@example.com", "000000")).rejects.toThrow(
      "That code is incorrect or has expired. Request a new one.",
    );
  });
});

describe("emailOtpErrorMessage", () => {
  it("translates the expired-or-invalid case into an actionable instruction", () => {
    // Supabase's own wording reads like a system fault rather than
    // "check the code", which is what the user actually needs to do.
    expect(emailOtpErrorMessage("Token has expired or is invalid", "verify")).toBe(
      "That code is incorrect or has expired. Request a new one.",
    );
  });

  it("explains that rate limiting is waited out, not retried", () => {
    expect(emailOtpErrorMessage("Email rate limit exceeded", "send")).toBe(
      "Too many attempts. Please wait a minute and try again.",
    );
  });

  it("distinguishes the send and verify stages", () => {
    expect(emailOtpErrorMessage("Service down", "send")).toContain("send your sign-in code");
    expect(emailOtpErrorMessage("Service down", "verify")).toContain("verify your code");
  });

  it("drops an unhelpfully long detail rather than dumping it on the user", () => {
    expect(emailOtpErrorMessage("x".repeat(300), "send")).toBe(
      "Could not send your sign-in code. Please try again.",
    );
  });
});
