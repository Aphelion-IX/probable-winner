import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "./supabase";
import { getStaffContext, type StaffContext } from "./staff-context";
import { safeRedirectPath } from "@/features/auth/safe-redirect";

/**
 * The path currently being rendered, as forwarded by proxy.ts.
 *
 * Still passed through safeRedirectPath: it arrives as a header, and headers
 * are not a trust boundary worth betting an open redirect on.
 */
export async function currentPathname(fallback = "/account"): Promise<string> {
  const headerList = await headers();
  return safeRedirectPath(headerList.get("x-pathname"), fallback);
}

export interface AuthContext {
  userId: string;
  email: string | null;
  displayName: string | null;
  /**
   * True when the profile row is missing or has no display name yet. Drives
   * the one-time profile setup step after a first sign-in.
   *
   * Email sign-in supplies nothing but an address, so every new account starts
   * here — there is no provider metadata to guess a name from.
   */
  needsProfileSetup: boolean;
  /**
   * Staff membership resolved from `staff_memberships`, or null for an
   * ordinary customer. This is the only source of internal access in the
   * application: it is a protected database row, not a session claim.
   */
  staff: StaffContext | null;
}

/**
 * Resolves the signed-in user, their profile state, and any staff membership.
 *
 * Returns null when there is no authenticated user. Uses `auth.getUser()`
 * rather than `auth.getSession()`: getUser() re-validates the token with the
 * auth server, whereas getSession() will happily hand back whatever is in the
 * cookie. For anything that gates access, the difference matters.
 */
export async function getAuthContext(): Promise<AuthContext | null> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle<{ display_name: string | null }>();

  const displayName = profile?.display_name ?? null;

  return {
    userId: user.id,
    email: user.email ?? null,
    displayName,
    needsProfileSetup: !profile || !displayName || displayName.trim() === "",
    staff: await getStaffContext(),
  };
}

/**
 * Guard for pages that require any signed-in user.
 *
 * `returnTo` is where to send them after they sign in — normally the page
 * they were trying to reach.
 */
export async function requireUser(returnTo?: string): Promise<AuthContext> {
  const context = await getAuthContext();

  if (!context) {
    const destination = returnTo ? safeRedirectPath(returnTo) : await currentPathname();
    redirect(`/login?next=${encodeURIComponent(destination)}`);
  }

  return context;
}

/**
 * Guard for the staff portal.
 *
 * Checks the membership first, then the specific permission when one is
 * required. A signed-in customer hitting a staff URL is sent home rather than
 * to login — they are authenticated, just not authorised, and bouncing them
 * to a sign-in form would be a confusing loop.
 *
 * This is a user-experience guard. It is not what protects the data: every
 * table the staff portal reads is covered by RLS policies that re-check the
 * same membership server-side, so a missed guard cannot leak rows.
 */
export async function requireStaff(
  permission?: string,
): Promise<AuthContext & { staff: StaffContext }> {
  const context = await getAuthContext();

  if (!context) {
    const destination = await currentPathname("/staff/dashboard");
    redirect(`/login?next=${encodeURIComponent(destination)}`);
  }

  if (!context.staff) {
    redirect("/");
  }

  if (permission && !context.staff.permissions.includes(permission)) {
    redirect("/staff/dashboard?denied=1");
  }

  return context as AuthContext & { staff: StaffContext };
}

/**
 * Guard for guest-only pages (the login screen). Sends an already-signed-in
 * user to where they were heading instead of showing them a sign-in form.
 */
export async function redirectIfSignedIn(returnTo?: string): Promise<void> {
  const context = await getAuthContext();

  if (!context) {
    return;
  }

  if (context.needsProfileSetup) {
    redirect(`/account/setup?next=${encodeURIComponent(safeRedirectPath(returnTo))}`);
  }

  redirect(destinationFor(context, returnTo));
}

/**
 * Where a signed-in user should land.
 *
 * An explicit, validated `next` always wins — it is the page they actually
 * asked for. Otherwise staff go to the portal and customers to their account.
 */
export function destinationFor(context: AuthContext, returnTo?: string | null): string {
  if (returnTo) {
    const safe = safeRedirectPath(returnTo, "");
    if (safe) {
      return safe;
    }
  }

  return context.staff ? "/staff/dashboard" : "/account";
}
