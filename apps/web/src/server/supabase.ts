import { createClient } from "@supabase/supabase-js";

// Anon/publishable key only — safe to hold server-side or client-side by
// design (RLS enforces access control), unlike the service-role key. See
// AGENTS.md rule 3: the service-role key must never appear here.
export function createServerSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set");
  }

  return createClient(url, anonKey);
}
