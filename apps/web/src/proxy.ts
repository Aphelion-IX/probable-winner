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
export function proxy(request: NextRequest) {
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

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set("x-request-id", requestId);

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
