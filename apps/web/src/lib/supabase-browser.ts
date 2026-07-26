import { createBrowserClient } from "@supabase/ssr";

// Browser-side Supabase client. Uses the same publishable/anon key as the
// server client — never the service-role key (AGENTS.md rule 3). The session
// lives in cookies rather than localStorage so that Server Components and
// route handlers can read it from the request (see server/supabase.ts).
//
// Memoised: @supabase/ssr's createBrowserClient already returns a singleton
// per set of arguments, but holding the reference here makes it obvious that
// the app has exactly one browser client and therefore one auth state
// listener source.
let client: ReturnType<typeof createBrowserClient> | undefined;

export function createBrowserSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set");
  }

  client ??= createBrowserClient(url, anonKey);
  return client;
}
