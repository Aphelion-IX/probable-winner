import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// B-201: stamp every request with a correlation id so Server Component/
// Action logs (apps/web/src/lib/logger.ts getRequestId()) can be tied back
// to the HTTP request that triggered them. Forwarded as a request header
// (readable via next/headers inside the app) and echoed as a response
// header for client-side/log-aggregator correlation.
export function proxy(request: NextRequest) {
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
