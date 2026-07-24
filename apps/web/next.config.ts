import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // @probable-winner/search ships raw TypeScript source (no build step) —
  // Next needs to compile it itself rather than treating it as pre-built JS.
  transpilePackages: ["@probable-winner/search"],
  images: {
    // Card images are Scryfall-hosted URLs stored directly in card_images
    // (not mirrored into our own storage) -- next/image blocks every
    // external host by default, so without this every <Image src=.../>
    // rendering a real card image throws at request time.
    remotePatterns: [{ protocol: "https", hostname: "**.scryfall.io" }],
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
