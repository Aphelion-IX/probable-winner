"use client";

import { createBrowserSupabaseClient } from "@/lib/supabase-browser";

// Supabase's actual emailed code length is set by the project's "Email OTP
// Length" dashboard setting, not by this app -- it is not always 6. A code
// longer than a hardcoded length would be silently truncated by a fixed
// `maxLength` and rejected by an exact-length check, which is exactly what
// happened in production (a real sign-in email carried an 8-digit code
// against a UI hardcoded to 6). Accept a range instead of a single length.
export const OTP_MIN_LENGTH = 6;
export const OTP_MAX_LENGTH = 10;

/**
 * Sends a one-time sign-in code to `email`.
 *
 * Supabase calls this "sign in with OTP", but it is also the sign-up path: a
 * first-time address gets an account created automatically. `shouldCreateUser`
 * is left at its default (true) for exactly that reason — there is no separate
 * registration step in this application.
 *
 * Whether the email contains a six-digit code or a magic link is decided by
 * the Magic Link email template in the Supabase dashboard, not here: a
 * template containing `{{ .Token }}` sends a code. See docs/authentication.md.
 */
export async function sendEmailOtp(email: string): Promise<void> {
  const supabase = createBrowserSupabaseClient();

  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
  });

  if (error) {
    throw new Error(emailOtpErrorMessage(error.message, "send"));
  }
}

/**
 * Exchanges the emailed code for a session.
 *
 * On success the browser client writes the auth cookies, which is what makes
 * the session visible to Server Components and route handlers on the next
 * navigation.
 */
export async function verifyEmailOtp(email: string, token: string): Promise<void> {
  const supabase = createBrowserSupabaseClient();

  const { error } = await supabase.auth.verifyOtp({
    email: email.trim(),
    token: token.trim(),
    type: "email",
  });

  if (error) {
    throw new Error(emailOtpErrorMessage(error.message, "verify"));
  }
}

/**
 * Turns a Supabase error into something worth showing a person.
 *
 * Two cases are worth translating rather than passing through. An expired or
 * wrong code is the single most common failure and Supabase's wording for it
 * ("Token has expired or is invalid") reads like a system fault rather than
 * "check the code and try again". Rate limiting is the second, and the raw
 * message does not make clear that waiting is the fix.
 */
export function emailOtpErrorMessage(detail: string, stage: "send" | "verify"): string {
  const lower = detail.toLowerCase();

  if (lower.includes("expired") || lower.includes("invalid")) {
    return "That code is incorrect or has expired. Request a new one.";
  }

  if (lower.includes("rate limit") || lower.includes("too many")) {
    return "Too many attempts. Please wait a minute and try again.";
  }

  const base =
    stage === "send" ? "Could not send your sign-in code." : "Could not verify your code.";

  // Short provider detail is usually the most useful thing available; a long
  // one is a stack-ish blob that helps nobody.
  return detail.length <= 120 ? `${base} ${detail}` : `${base} Please try again.`;
}
