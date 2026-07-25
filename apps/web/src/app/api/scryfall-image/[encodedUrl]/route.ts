import { NextResponse } from "next/server";

// Scryfall rejects requests carrying a generic/default HTTP-library
// User-Agent with 400 "generic_user_agent" -- confirmed directly: the same
// request fails with Node's bare fetch() and succeeds the instant a real
// User-Agent header is added. next/image's built-in optimizer fetches
// remote images server-side with no way to set custom headers, so every
// <Image src="https://cards.scryfall.io/..."> 400s. Routing through this
// proxy (same-origin, so next/image never talks to Scryfall directly) lets
// us set the header Scryfall actually requires.
//
// The upstream URL is a path segment, not a query param: next/image's
// localPatterns config (required for any same-origin optimized image) can
// only match query strings literally, not with a wildcard, so a `?url=`
// query param could never be allow-listed for arbitrary Scryfall URLs.
// encodeURIComponent keeps the whole URL within one path segment.
const ALLOWED_HOSTS = new Set(["cards.scryfall.io"]);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ encodedUrl: string }> },
) {
  const { encodedUrl } = await params;

  let upstreamUrl: URL;
  try {
    upstreamUrl = new URL(decodeURIComponent(encodedUrl));
  } catch {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }

  if (upstreamUrl.protocol !== "https:" || !ALLOWED_HOSTS.has(upstreamUrl.hostname)) {
    return NextResponse.json({ error: "URL host not allowed" }, { status: 400 });
  }

  const upstream = await fetch(upstreamUrl, {
    headers: {
      "User-Agent": "ProbableWinner/1.0 (card image proxy)",
      Accept: "image/*",
    },
  });

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "Upstream image fetch failed" }, { status: 502 });
  }

  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "image/jpeg",
      // Scryfall image URLs carry a cache-busting timestamp query param, so
      // the full URL (our cache key here) never points at stale bytes.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
