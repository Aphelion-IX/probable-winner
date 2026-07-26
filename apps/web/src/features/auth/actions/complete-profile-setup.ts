"use server";

import { revalidatePath } from "next/cache";

import { createServerSupabaseClient } from "@/server/supabase";
import { logger, getRequestId } from "@/lib/logger";
import { DISPLAY_NAME_MAX_LENGTH } from "../profile-setup-constants";

export type ProfileSetupResult = { ok: true; redirectTo: string } | { ok: false; error: string };

/**
 * Completes first-time profile setup by setting the display name.
 *
 * Only ever writes the caller's own row: the `id = user.id` filter plus the
 * `profiles_update` RLS policy (`id = auth.uid()`) both scope it, so a forged
 * request cannot rename someone else. `profiles` holds no role or permission
 * column, so there is nothing privilege-bearing to protect here beyond that.
 *
 * Returns a result rather than redirecting so the caller can render a
 * validation message in place; the caller performs the navigation.
 */
export async function completeProfileSetup(displayName: string): Promise<ProfileSetupResult> {
  const trimmed = displayName.trim();

  if (trimmed === "") {
    return { ok: false, error: "Please enter a display name." };
  }

  if (trimmed.length > DISPLAY_NAME_MAX_LENGTH) {
    return {
      ok: false,
      error: `Display name must be ${DISPLAY_NAME_MAX_LENGTH} characters or fewer.`,
    };
  }

  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Your session has expired. Please sign in again." };
  }

  const { error } = await supabase
    .from("profiles")
    .update({ display_name: trimmed })
    .eq("id", user.id);

  if (error) {
    logger.error("Profile setup failed", {
      requestId: await getRequestId(),
      userId: user.id,
      error: logger.serializeError(error),
    });
    return { ok: false, error: "Could not save your profile. Please try again." };
  }

  revalidatePath("/", "layout");

  return { ok: true, redirectTo: "/account" };
}
