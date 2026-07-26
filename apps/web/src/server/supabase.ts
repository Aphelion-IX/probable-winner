import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Anon/publishable key only — safe to hold server-side or client-side by
// design (RLS enforces access control), unlike the service-role key. See
// AGENTS.md rule 3: the service-role key must never appear here.
//
// This is cookie-aware (@supabase/ssr) rather than a bare createClient. The
// bare client keeps its session in memory, so on the server it started every
// request with no session at all and auth.getUser() always resolved to null —
// which is why nothing behind requireCustomerId()/getStaffContext() could ever
// see a signed-in user. Reading the request's auth cookies is what makes a
// browser session visible to Server Components, Server Actions and route
// handlers.
//
// Async because next/headers cookies() is async in Next.js 16. Callers must
// await it.
export async function createServerSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set");
  }

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        // Server Components cannot set cookies; Next throws if you try. That
        // is expected and safe to swallow here because proxy.ts refreshes the
        // session cookie on every matched request, so the refreshed token is
        // still written exactly once per request from a context that is
        // allowed to write it.
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // no-op: see above
        }
      },
    },
  });
}
