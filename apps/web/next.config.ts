import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // @probable-winner/search ships raw TypeScript source (no build step) —
  // Next needs to compile it itself rather than treating it as pre-built JS.
  transpilePackages: ["@probable-winner/search"],
  images: {
    // Card images are Scryfall-hosted URLs stored directly in card_images
    // (not mirrored into our own storage). They're routed through
    // /api/scryfall-image rather than passed straight to <Image src=.../> --
    // Scryfall rejects the generic User-Agent next/image's built-in
    // optimizer sends for direct remote fetches -- so no remotePatterns
    // entry is needed; every Scryfall fetch goes through that route
    // instead, same-origin. next/image still requires local (same-origin)
    // paths to be explicitly allow-listed; localPatterns' `search` only
    // matches a literal query string (no wildcard), which is why the
    // upstream URL is a path segment here rather than a `?url=` query param.
    localPatterns: [{ pathname: "/api/scryfall-image/*", search: "" }],
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  // Source maps are only uploaded when SENTRY_AUTH_TOKEN is set (CI/CD), so
  // local builds without Sentry credentials configured are unaffected.
  widenClientFileUpload: true,
  webpack: {
    treeshake: { removeDebugLogging: true },
    automaticVercelMonitors: true,
  },
});
