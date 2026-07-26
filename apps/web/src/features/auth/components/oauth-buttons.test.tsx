import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockSignInWithOAuth = vi.fn();

vi.mock("../sign-in-with-oauth", async () => {
  const actual = await vi.importActual<typeof import("../sign-in-with-oauth")>(
    "../sign-in-with-oauth",
  );
  return { ...actual, signInWithOAuth: mockSignInWithOAuth };
});

const { OAuthButtons } = await import("./oauth-buttons");

describe("OAuthButtons", () => {
  beforeEach(() => {
    mockSignInWithOAuth.mockReset();
    mockSignInWithOAuth.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("offers both providers with the official wording", () => {
    render(<OAuthButtons />);

    expect(screen.getByRole("button", { name: /continue with google/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue with apple/i })).toBeInTheDocument();
  });

  it("starts the Google flow when the Google button is used", async () => {
    render(<OAuthButtons />);

    fireEvent.click(screen.getByRole("button", { name: /continue with google/i }));

    await waitFor(() => expect(mockSignInWithOAuth).toHaveBeenCalledWith("google", undefined));
  });

  it("starts the Apple flow when the Apple button is used", async () => {
    render(<OAuthButtons />);

    fireEvent.click(screen.getByRole("button", { name: /continue with apple/i }));

    await waitFor(() => expect(mockSignInWithOAuth).toHaveBeenCalledWith("apple", undefined));
  });

  it("passes the return path through to the provider flow", async () => {
    render(<OAuthButtons returnTo="/account/orders" />);

    fireEvent.click(screen.getByRole("button", { name: /continue with google/i }));

    await waitFor(() =>
      expect(mockSignInWithOAuth).toHaveBeenCalledWith("google", "/account/orders"),
    );
  });

  it("shows a provider error and re-enables the buttons", async () => {
    mockSignInWithOAuth.mockRejectedValue(new Error("Could not start sign-in with Apple."));
    render(<OAuthButtons />);

    fireEvent.click(screen.getByRole("button", { name: /continue with apple/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not start sign-in with Apple.");

    // A failed attempt must be retryable — the redirect never happened.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /continue with apple/i })).not.toBeDisabled();
    });
  });

  it("surfaces an error handed down from the callback route", () => {
    render(<OAuthButtons initialError="Sign-in was cancelled." />);

    expect(screen.getByRole("alert")).toHaveTextContent("Sign-in was cancelled.");
  });

  it("ignores repeated clicks while a redirect is in flight", async () => {
    // The redirect is in progress but the page is still interactive, so a
    // second click must not start a second OAuth flow.
    mockSignInWithOAuth.mockImplementation(() => new Promise(() => {}));
    render(<OAuthButtons />);

    const google = screen.getByRole("button", { name: /continue with google/i });
    fireEvent.click(google);

    await waitFor(() => expect(google).toBeDisabled());
    expect(screen.getByRole("button", { name: /continue with apple/i })).toBeDisabled();

    fireEvent.click(google);
    expect(mockSignInWithOAuth).toHaveBeenCalledTimes(1);
  });

  it("marks only the selected provider as busy", async () => {
    mockSignInWithOAuth.mockImplementation(() => new Promise(() => {}));
    render(<OAuthButtons />);

    fireEvent.click(screen.getByRole("button", { name: /continue with apple/i }));

    await waitFor(() => {
      expect(screen.getByTestId("oauth-apple")).toHaveAttribute("aria-busy", "true");
    });
    expect(screen.getByTestId("oauth-google")).not.toHaveAttribute("aria-busy", "true");
  });
});
