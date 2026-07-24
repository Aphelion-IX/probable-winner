import { unstable_cache } from "next/cache";

import { createServerSupabaseClient } from "@/server/supabase";

// Which stores accept click-and-collect (and their addresses) changes
// rarely, so this is safe to cache like list-active-stores.ts.
const CC_STORES_REVALIDATE_SECONDS = 3600;
const CC_STORES_CACHE_KEY = ["click-and-collect-stores"];
const CC_STORES_CACHE_TAG = "click-and-collect-stores";

export type ClickAndCollectStore = {
  id: string;
  name: string;
  code: string;
  region: string | null;
  address: {
    line1: string;
    line2: string | null;
    city: string;
    region: string | null;
    postalCode: string | null;
    country: string;
  } | null;
};

type StoreAddressRow = {
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postal_code: string | null;
  country: string;
};

type StoreRow = {
  id: string;
  name: string;
  code: string;
  region: string | null;
  store_addresses: StoreAddressRow[] | null;
};

export function mapStoreRow(row: StoreRow): ClickAndCollectStore {
  const address = row.store_addresses?.[0] ?? null;

  return {
    id: row.id,
    name: row.name,
    code: row.code,
    region: row.region,
    address: address
      ? {
          line1: address.line1,
          line2: address.line2,
          city: address.city,
          region: address.region,
          postalCode: address.postal_code,
          country: address.country,
        }
      : null,
  };
}

async function fetchClickAndCollectStores(): Promise<ClickAndCollectStore[]> {
  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("fulfilment_nodes")
    .select(
      "id, name, code, region, store_addresses(line1, line2, city, region, postal_code, country)",
    )
    .eq("active", true)
    .eq("allows_click_collect", true)
    .order("name", { ascending: true })
    .returns<StoreRow[]>();

  if (error) {
    throw new Error(`Failed to list click-and-collect stores: ${error.message}`);
  }

  return (data ?? []).map(mapStoreRow);
}

export async function listClickAndCollectStores(): Promise<ClickAndCollectStore[]> {
  const cached = unstable_cache(fetchClickAndCollectStores, CC_STORES_CACHE_KEY, {
    revalidate: CC_STORES_REVALIDATE_SECONDS,
    tags: [CC_STORES_CACHE_TAG],
  });

  return cached();
}
