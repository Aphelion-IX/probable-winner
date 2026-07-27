"use server";

import { createServerSupabaseClient } from "@/server/supabase";
import { setPreferredStoreCookie } from "@/lib/cart-session";

export interface SelectStoreResult {
  success: boolean;
  error?: string;
}

// Persists a store selection made via HeaderStoreSelector so it actually
// feeds resolveDefaultStore() (backlog B-090/B-170) instead of being
// decorative local state. An authenticated customer's choice is written to
// profiles.preferred_fulfilment_node_id -- the same column the account
// page's ProfileEditor already writes -- so picking a store from either
// place stays in sync. A guest's choice goes into a cookie, since there is
// no profile row to persist it against.
export async function selectPreferredStore(storeId: string): Promise<SelectStoreResult> {
  const supabase = await createServerSupabaseClient();

  const { data: store, error: storeError } = await supabase
    .from("fulfilment_nodes")
    .select("id")
    .eq("id", storeId)
    .eq("active", true)
    .maybeSingle();

  if (storeError) {
    return { success: false, error: storeError.message };
  }
  if (!store) {
    return { success: false, error: "That store is not currently active." };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { error } = await supabase
      .from("profiles")
      .update({ preferred_fulfilment_node_id: storeId })
      .eq("id", user.id);

    if (error) {
      return { success: false, error: error.message };
    }
  } else {
    await setPreferredStoreCookie(storeId);
  }

  return { success: true };
}
