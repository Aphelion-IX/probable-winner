import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { checkRateLimit, RATE_LIMIT_RULES } from "@/lib/rate-limit";

// B-203: only search/browse and checkout-adjacent paths are rate limited —
// everything else (staff portal, account pages, API health check) is
// unaffected. Matched by prefix against the pathname below.
const SEARCH_PATH_PREFIXES = ["/search", "/cards", "/sets"];
const CHECKOUT_PATH_PREFIXES = ["/cart", "/checkout"];

function matchesPrefix(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function getClientId(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}

function rateLimitResponse(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: "Too many requests, please slow down." },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfterSeconds) },
    },
  );
}

// B-201: stamp every request with a correlation id so Server Component/
// Action logs (apps/web/src/lib/logger.ts getRequestId()) can be tied back
// to the HTTP request that triggered them. Forwarded as a request header
// (readable via next/headers inside the app) and echoed as a response
// header for client-side/log-aggregator correlation.
// Refreshes the Supabase auth session cookie when the access token has
// expired. Server Components cannot write cookies, so without this the
// refreshed token would be computed and then thrown away on every request and
// a user would appear signed out as soon as their access token aged out. This
// is the only place the session cookie is written server-side.
//
// Deliberately only calls getUser(): that is what triggers the refresh. No
// authorization decision is made here — route guards resolve the user and
// their database role themselves (see server/auth-context.ts). Middleware is
// the wrong layer for authorization because it cannot be the thing RLS trusts.
async function refreshAuthSession(request: NextRequest, response: NextResponse): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Not configured (e.g. a build-time or preview environment without Supabase
  // env vars): skip rather than throwing and taking down every route.
  if (!url || !anonKey) {
    return;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  await supabase.auth.getUser();
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (matchesPrefix(pathname, SEARCH_PATH_PREFIXES)) {
    const result = checkRateLimit("search", getClientId(request), RATE_LIMIT_RULES.search);
    if (result.limited) {
      return rateLimitResponse(result.retryAfterSeconds);
    }
  } else if (matchesPrefix(pathname, CHECKOUT_PATH_PREFIXES)) {
    const result = checkRateLimit("checkout", getClientId(request), RATE_LIMIT_RULES.checkout);
    if (result.limited) {
      return rateLimitResponse(result.retryAfterSeconds);
    }
  }

  const requestId = crypto.randomUUID();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);
  // Server Components cannot see the request path. Route guards need it to
  // build an accurate "send me back here after sign-in" return path, so it is
  // forwarded explicitly (pathname and search only — never the origin, so it
  // cannot become an open redirect).
  requestHeaders.set("x-pathname", `${request.nextUrl.pathname}${request.nextUrl.search}`);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set("x-request-id", requestId);

  await refreshAuthSession(request, response);

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)"],
};
