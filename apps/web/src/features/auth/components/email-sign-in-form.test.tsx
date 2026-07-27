import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockSendEmailOtp = vi.fn();
const mockVerifyEmailOtp = vi.fn();
const mockReplace = vi.fn();
const mockRefresh = vi.fn();

vi.mock("../sign-in-with-email", async () => {
  const actual =
    await vi.importActual<typeof import("../sign-in-with-email")>("../sign-in-with-email");
  return { ...actual, sendEmailOtp: mockSendEmailOtp, verifyEmailOtp: mockVerifyEmailOtp };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, refresh: mockRefresh }),
}));

const { EmailSignInForm } = await import("./email-sign-in-form");

function typeEmail(value: string) {
  fireEvent.change(screen.getByLabelText(/email address/i), { target: { value } });
}

function typeCode(value: string) {
  fireEvent.change(screen.getByLabelText(/sign-in code/i), { target: { value } });
}

async function reachCodeStage(email = "player@example.com") {
  render(<EmailSignInForm />);
  typeEmail(email);
  fireEvent.click(screen.getByTestId("send-code"));
  await screen.findByLabelText(/sign-in code/i);
}

describe("EmailSignInForm", () => {
  beforeEach(() => {
    mockSendEmailOtp.mockReset().mockResolvedValue(undefined);
    mockVerifyEmailOtp.mockReset().mockResolvedValue(undefined);
    mockReplace.mockReset();
    mockRefresh.mockReset();
  });

  afterEach(cleanup);

  it("asks for an email first", () => {
    render(<EmailSignInForm />);

    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/sign-in code/i)).not.toBeInTheDocument();
  });

  it("sends a code to the address entered", async () => {
    await reachCodeStage("player@example.com");

    expect(mockSendEmailOtp).toHaveBeenCalledWith("player@example.com");
  });

  it("confirms where the code was sent", async () => {
    await reachCodeStage("player@example.com");

    expect(screen.getByTestId("sign-in-notice")).toHaveTextContent("player@example.com");
  });

  it("stays on the email step and explains when sending fails", async () => {
    mockSendEmailOtp.mockRejectedValue(new Error("Too many attempts. Please wait a minute."));
    render(<EmailSignInForm />);

    typeEmail("player@example.com");
    fireEvent.click(screen.getByTestId("send-code"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts");
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
  });

  it("keeps the verify button disabled until the code is complete", async () => {
    await reachCodeStage();

    expect(screen.getByTestId("verify-code")).toBeDisabled();

    typeCode("12345");
    expect(screen.getByTestId("verify-code")).toBeDisabled();

    typeCode("123456");
    expect(screen.getByTestId("verify-code")).not.toBeDisabled();
  });

  it("strips non-digits from the code input", async () => {
    await reachCodeStage();

    typeCode("12a3-4b");
    expect(screen.getByLabelText(/sign-in code/i)).toHaveValue("1234");
  });

  // Regression: Supabase's actual emailed code length is a project-level
  // dashboard setting, not a constant this app controls -- a real sign-in
  // email has carried an 8-digit code while this input was hardcoded to
  // exactly 6, silently truncating and then rejecting it.
  it("accepts a code longer than 6 digits without truncating it", async () => {
    await reachCodeStage("player@example.com");

    typeCode("71661872");
    expect(screen.getByLabelText(/sign-in code/i)).toHaveValue("71661872");
    expect(screen.getByTestId("verify-code")).not.toBeDisabled();

    fireEvent.click(screen.getByTestId("verify-code"));

    await waitFor(() =>
      expect(mockVerifyEmailOtp).toHaveBeenCalledWith("player@example.com", "71661872"),
    );
  });

  it("verifies the code and hands off to /auth/complete", async () => {
    await reachCodeStage("player@example.com");

    typeCode("123456");
    fireEvent.click(screen.getByTestId("verify-code"));

    await waitFor(() =>
      expect(mockVerifyEmailOtp).toHaveBeenCalledWith("player@example.com", "123456"),
    );
    expect(mockReplace).toHaveBeenCalledWith("/auth/complete");
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("carries a return path through to /auth/complete", async () => {
    render(<EmailSignInForm returnTo="/account/orders" />);
    typeEmail("player@example.com");
    fireEvent.click(screen.getByTestId("send-code"));
    await screen.findByLabelText(/sign-in code/i);

    typeCode("123456");
    fireEvent.click(screen.getByTestId("verify-code"));

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith("/auth/complete?next=%2Faccount%2Forders"),
    );
  });

  it("shows a wrong code as recoverable and does not navigate", async () => {
    mockVerifyEmailOtp.mockRejectedValue(
      new Error("That code is incorrect or has expired. Request a new one."),
    );
    await reachCodeStage();

    typeCode("000000");
    fireEvent.click(screen.getByTestId("verify-code"));

    expect(await screen.findByRole("alert")).toHaveTextContent("incorrect or has expired");
    expect(mockReplace).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId("verify-code")).not.toBeDisabled());
  });

  it("lets the user go back and correct a mistyped email", async () => {
    await reachCodeStage("wrong@example.com");

    fireEvent.click(screen.getByTestId("change-email"));

    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/sign-in code/i)).not.toBeInTheDocument();
  });

  it("surfaces an error handed down from /auth/complete", () => {
    render(<EmailSignInForm initialError="Your sign-in did not complete." />);

    expect(screen.getByRole("alert")).toHaveTextContent("Your sign-in did not complete.");
  });

  it("ignores a repeated submit while a request is in flight", async () => {
    mockSendEmailOtp.mockImplementation(() => new Promise(() => {}));
    render(<EmailSignInForm />);

    typeEmail("player@example.com");
    const button = screen.getByTestId("send-code");
    fireEvent.click(button);

    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);

    expect(mockSendEmailOtp).toHaveBeenCalledTimes(1);
  });
});
