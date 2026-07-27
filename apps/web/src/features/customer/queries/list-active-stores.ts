import { unstable_cache } from "next/cache";

import { createPublicSupabaseClient } from "@/server/supabase";

// Which stores are active changes rarely (opening/closing a store), so this
// is safe to cache like the catalogue queries in features/catalogue.
const ACTIVE_STORES_REVALIDATE_SECONDS = 3600;
const ACTIVE_STORES_CACHE_KEY = ["active-stores"];
const ACTIVE_STORES_CACHE_TAG = "active-stores";

export type ActiveStore = {
  id: string;
  name: string;
  code: string;
  region: string | null;
};

type StoreRow = {
  id: string;
  name: string;
  code: string;
  region: string | null;
};

async function fetchActiveStores(): Promise<ActiveStore[]> {
  // Not createServerSupabaseClient(): this is wrapped in unstable_cache()
  // below, which forbids calling cookies() (which that client awaits) --
  // and the active-store list is identical for every viewer regardless of
  // session, so there was never a reason to attach one.
  const supabase = createPublicSupabaseClient();

  const { data, error } = await supabase
    .from("fulfilment_nodes")
    .select("id, name, code, region")
    .eq("active", true)
    .order("name", { ascending: true })
    .returns<StoreRow[]>();

  if (error) {
    throw new Error(`Failed to list stores: ${error.message}`);
  }

  return data ?? [];
}

export async function listActiveStores(): Promise<ActiveStore[]> {
  const cached = unstable_cache(fetchActiveStores, ACTIVE_STORES_CACHE_KEY, {
    revalidate: ACTIVE_STORES_REVALIDATE_SECONDS,
    tags: [ACTIVE_STORES_CACHE_TAG],
  });

  return cached();
}
