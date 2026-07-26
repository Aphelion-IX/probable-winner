"use client";

import { createBrowserSupabaseClient } from "@/lib/supabase-browser";
import { safeRedirectPath } from "./safe-redirect";

/**
 * The providers this application supports. Adding one here is deliberately a
 * type-level change so a typo cannot silently start an unsupported flow.
 */
export type SupportedOAuthProvider = "google" | "apple";

export const OAUTH_PROVIDER_LABELS: Record<SupportedOAuthProvider, string> = {
  // Official wording required by both providers' branding guidelines.
  google: "Continue with Google",
  apple: "Continue with Apple",
};

/**
 * Starts the OAuth redirect for `provider`.
 *
 * Resolves only if the redirect could not be started; on success the browser
 * navigates away, so code after the call should not assume it runs.
 *
 * `returnTo` is the path the user was trying to reach before being sent to
 * login. It is validated here as well as on the way back out of the callback:
 * it travels through a URL the user controls, so it is never trusted on
 * either leg.
 */
export async function signInWithOAuth(
  provider: SupportedOAuthProvider,
  returnTo?: string,
): Promise<void> {
  const supabase = createBrowserSupabaseClient();

  const callbackUrl = new URL("/auth/callback", window.location.origin);
  if (returnTo) {
    // safeRedirectPath returns the fallback for anything off-origin, so a
    // hostile `returnTo` degrades to the default rather than being forwarded.
    callbackUrl.searchParams.set("next", safeRedirectPath(returnTo));
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: callbackUrl.toString() },
  });

  if (error) {
    throw new Error(oauthErrorMessage(provider, error.message));
  }
}

/**
 * Turns a Supabase error into something worth showing a person.
 *
 * The raw message is appended only when it is short enough to be a real
 * explanation rather than a stack-ish blob, and it is never the whole message
 * on its own — "Unable to sign in" with no context is not actionable, and a
 * bare provider error is not readable.
 */
export function oauthErrorMessage(provider: SupportedOAuthProvider, detail?: string): string {
  const providerName = provider === "google" ? "Google" : "Apple";
  const base = `Could not start sign-in with ${providerName}.`;

  if (detail && detail.length <= 120) {
    return `${base} ${detail}`;
  }

  return `${base} Please try again.`;
}
