import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { createServerSupabaseClient } from "@/server/supabase";
import { getStaffContext } from "@/server/staff-context";
import { safeRedirectPath } from "@/features/auth/safe-redirect";
import { logger, getRequestId } from "@/lib/logger";

// The OAuth session is established here, so this must run per-request.
export const dynamic = "force-dynamic";

function loginWithError(request: NextRequest, message: string, next: string | null) {
  const url = new URL("/login", request.url);
  url.searchParams.set("error", message);
  if (next) {
    url.searchParams.set("next", next);
  }
  return NextResponse.redirect(url);
}

/**
 * OAuth redirect target for both providers.
 *
 * The URL alone is never taken as proof of anything. A `code` in the query
 * string only means the browser arrived here — the session is not real until
 * `exchangeCodeForSession` succeeds, and the user is not known until
 * `getUser()` re-validates the resulting token against the auth server.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // `next` is attacker-controllable; validate before it is echoed into any
  // redirect, including the error ones.
  const requestedNext = searchParams.get("next");
  const next = requestedNext ? safeRedirectPath(requestedNext, "") || null : null;

  // The provider itself can report a failure — most commonly the user
  // cancelling on the provider's consent screen.
  const providerError = searchParams.get("error");
  const providerErrorDescription = searchParams.get("error_description");

  if (providerError) {
    // Deliberately not logged with the raw description at info level beyond
    // this: provider error strings can carry account identifiers.
    logger.warn("OAuth provider returned an error", {
      requestId: await getRequestId(),
      providerError,
    });

    const message =
      providerError === "access_denied"
        ? "Sign-in was cancelled."
        : providerErrorDescription || "Sign-in failed. Please try again.";

    return loginWithError(request, message, next);
  }

  const code = searchParams.get("code");

  if (!code) {
    return loginWithError(request, "Sign-in did not complete. Please try again.", next);
  }

  const supabase = await createServerSupabaseClient();

  // Exchanges the one-time code for a session and writes the auth cookies.
  // Never log `code` or the resulting tokens.
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    logger.error("OAuth code exchange failed", {
      requestId: await getRequestId(),
      error: logger.serializeError(exchangeError),
    });
    return loginWithError(request, "Could not complete sign-in. Please try again.", next);
  }

  // Re-validate rather than trusting the exchange result.
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    logger.error("OAuth callback could not resolve a user after exchange", {
      requestId: await getRequestId(),
      error: userError ? logger.serializeError(userError) : undefined,
    });
    return loginWithError(request, "Could not complete sign-in. Please try again.", next);
  }

  // `profiles` rows are normally created by the handle_new_customer() trigger
  // on auth.users insert. This is a backstop for accounts that predate the
  // trigger or where it did not run — without it such a user is permanently
  // stuck with no profile and no way to make one.
  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle<{ display_name: string | null }>();

  let displayName = existingProfile?.display_name ?? null;

  if (!existingProfile) {
    // Provider data is a *suggestion* for a brand-new row only. An existing
    // profile is never overwritten from provider metadata — that would let a
    // provider silently rewrite a name the user chose themselves.
    const suggestedName = suggestedDisplayName(user.user_metadata);

    const { error: insertError } = await supabase
      .from("profiles")
      .insert({ id: user.id, display_name: suggestedName });

    // A duplicate here means the trigger won the race — that is a success,
    // not a failure, so only a non-duplicate error is worth reporting.
    if (insertError && insertError.code !== "23505") {
      logger.error("Failed to create profile during OAuth callback", {
        requestId: await getRequestId(),
        userId: user.id,
        error: logger.serializeError(insertError),
      });
    } else {
      displayName = suggestedName;
    }
  }

  const needsProfileSetup = !displayName || displayName.trim() === "";

  if (needsProfileSetup) {
    const setupUrl = new URL("/account/setup", request.url);
    if (next) {
      setupUrl.searchParams.set("next", next);
    }
    return NextResponse.redirect(setupUrl);
  }

  // Internal access comes from staff_memberships, never from the provider,
  // the email domain, or anything in user_metadata.
  const staff = await getStaffContext();

  const destination = next ?? (staff ? "/staff/dashboard" : "/account");

  return NextResponse.redirect(new URL(destination, request.url));
}

/**
 * Best-effort display name from provider metadata.
 *
 * Google supplies `full_name`/`name`. Apple only supplies a name on the very
 * first authorisation and users may decline it, so a null result here is
 * normal and simply routes the user through profile setup.
 */
function suggestedDisplayName(metadata: Record<string, unknown> | undefined): string | null {
  if (!metadata) {
    return null;
  }

  for (const key of ["full_name", "name", "preferred_username"]) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }

  return null;
}
