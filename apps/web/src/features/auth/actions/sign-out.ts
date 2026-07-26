"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "@/server/supabase";

/**
 * Signs the user out and clears any cached view of their data.
 *
 * The revalidate matters as much as the signOut: Server Components render
 * against the session that existed when they were cached, so without it a
 * signed-out user can be shown their own account or staff pages from cache
 * until something else happens to invalidate them.
 *
 * Runs as a Server Action rather than in the browser so the auth cookies are
 * cleared server-side, which is the only place they can actually be removed.
 */
export async function signOut(): Promise<void> {
  const supabase = await createServerSupabaseClient();

  await supabase.auth.signOut();

  revalidatePath("/", "layout");
  redirect("/");
}
