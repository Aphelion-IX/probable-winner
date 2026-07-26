import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { createServerSupabaseClient } from "@/server/supabase";
import { getStaffContext } from "@/server/staff-context";
import { safeRedirectPath } from "@/features/auth/safe-redirect";
import { logger, getRequestId } from "@/lib/logger";

// Resolves the just-signed-in user, so it must run per request.
export const dynamic = "force-dynamic";

/**
 * Where the browser is sent immediately after a successful code verification.
 *
 * The client verifies the OTP (which writes the auth cookies) and then
 * navigates here. This route does the parts that must happen server-side:
 * confirm there really is a session, make sure the user has a profile, and
 * decide where they belong.
 *
 * Being sent here is never treated as proof of anything. The session is only
 * real if `getUser()` — which re-validates the token against the auth server —
 * returns a user; anyone can type this URL.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Attacker-controllable; validate before it is echoed into any redirect.
  const requestedNext = searchParams.get("next");
  const next = requestedNext ? safeRedirectPath(requestedNext, "") || null : null;

  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("error", "Your sign-in did not complete. Please try again.");
    if (next) {
      loginUrl.searchParams.set("next", next);
    }
    return NextResponse.redirect(loginUrl);
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
    const { error: insertError } = await supabase
      .from("profiles")
      .insert({ id: user.id, display_name: null });

    // A duplicate means the trigger won the race — a success, not a failure.
    if (insertError && insertError.code !== "23505") {
      logger.error("Failed to create profile after sign-in", {
        requestId: await getRequestId(),
        userId: user.id,
        error: logger.serializeError(insertError),
      });
    } else {
      displayName = null;
    }
  }

  // Email sign-in never supplies a name, so a first-time user always passes
  // through profile setup.
  if (!displayName || displayName.trim() === "") {
    const setupUrl = new URL("/account/setup", request.url);
    if (next) {
      setupUrl.searchParams.set("next", next);
    }
    return NextResponse.redirect(setupUrl);
  }

  // Internal access comes from staff_memberships, never from the session.
  const staff = await getStaffContext();

  return NextResponse.redirect(
    new URL(next ?? (staff ? "/staff/dashboard" : "/account"), request.url),
  );
}
