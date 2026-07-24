"use server";

import { createServerSupabaseClient } from "@/server/supabase";
import { logger, getRequestId } from "@/lib/logger";

export interface CustomerProfile {
  id: string;
  displayName: string | null;
  phone: string | null;
  preferredFulfilmentNodeId: string | null;
}

interface ProfileRow {
  id: string;
  display_name: string | null;
  phone: string | null;
  preferred_fulfilment_node_id: string | null;
}

export interface CustomerAddress {
  id: string;
  label: string | null;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postalCode: string | null;
  country: string;
  isDefault: boolean;
}

interface AddressRow {
  id: string;
  label: string | null;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postal_code: string | null;
  country: string;
  is_default: boolean;
}

async function requireCustomerId(supabase: ReturnType<typeof createServerSupabaseClient>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  return user.id;
}

export async function getProfile(): Promise<CustomerProfile> {
  const supabase = createServerSupabaseClient();
  const customerId = await requireCustomerId(supabase);

  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, phone, preferred_fulfilment_node_id")
    .eq("id", customerId)
    .single<ProfileRow>();

  if (error) {
    logger.error("Fetch profile failed", {
      requestId: await getRequestId(),
      customerId,
      error: logger.serializeError(error),
    });
    throw new Error("Failed to fetch profile");
  }

  return {
    id: data.id,
    displayName: data.display_name,
    phone: data.phone,
    preferredFulfilmentNodeId: data.preferred_fulfilment_node_id,
  };
}

export async function updateProfile(input: {
  displayName: string;
  phone: string;
  preferredFulfilmentNodeId: string | null;
}): Promise<void> {
  const supabase = createServerSupabaseClient();
  const customerId = await requireCustomerId(supabase);

  const { error } = await supabase
    .from("profiles")
    .update({
      display_name: input.displayName.trim() || null,
      phone: input.phone.trim() || null,
      preferred_fulfilment_node_id: input.preferredFulfilmentNodeId,
    })
    .eq("id", customerId);

  if (error) {
    logger.error("Update profile failed", {
      requestId: await getRequestId(),
      customerId,
      error: logger.serializeError(error),
    });
    throw new Error("Failed to update profile");
  }
}

export async function listAddresses(): Promise<CustomerAddress[]> {
  const supabase = createServerSupabaseClient();
  const customerId = await requireCustomerId(supabase);

  const { data, error } = await supabase
    .from("customer_addresses")
    .select("id, label, line1, line2, city, region, postal_code, country, is_default")
    .eq("customer_id", customerId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .returns<AddressRow[]>();

  if (error) {
    logger.error("List addresses failed", {
      requestId: await getRequestId(),
      customerId,
      error: logger.serializeError(error),
    });
    throw new Error("Failed to fetch addresses");
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    label: row.label,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    region: row.region,
    postalCode: row.postal_code,
    country: row.country,
    isDefault: row.is_default,
  }));
}

export async function createAddress(input: {
  label: string;
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}): Promise<string> {
  const supabase = createServerSupabaseClient();
  const customerId = await requireCustomerId(supabase);

  const { data, error } = await supabase
    .from("customer_addresses")
    .insert({
      customer_id: customerId,
      label: input.label.trim() || null,
      line1: input.line1.trim(),
      line2: input.line2.trim() || null,
      city: input.city.trim(),
      region: input.region.trim() || null,
      postal_code: input.postalCode.trim() || null,
      country: input.country.trim(),
    })
    .select("id")
    .single();

  if (error) {
    logger.error("Create address failed", {
      requestId: await getRequestId(),
      customerId,
      error: logger.serializeError(error),
    });
    throw new Error("Failed to save address");
  }

  return data.id as string;
}

export async function deleteAddress(addressId: string): Promise<void> {
  const supabase = createServerSupabaseClient();
  const customerId = await requireCustomerId(supabase);

  const { error } = await supabase
    .from("customer_addresses")
    .delete()
    .eq("id", addressId)
    .eq("customer_id", customerId);

  if (error) {
    logger.error("Delete address failed", {
      requestId: await getRequestId(),
      customerId,
      addressId,
      error: logger.serializeError(error),
    });
    throw new Error("Failed to delete address");
  }
}
