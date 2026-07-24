import * as Sentry from "@sentry/nextjs";

// B-200: edge runtime (proxy.ts) error and performance monitoring.
Sentry.init({
  dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? "development",
  tracesSampleRate: process.env.SENTRY_ENVIRONMENT === "production" ? 0.2 : 1.0,
  enabled: Boolean(process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN),
});
