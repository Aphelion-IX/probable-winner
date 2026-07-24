import * as Sentry from "@sentry/nextjs";

// B-200: browser-side error and performance monitoring. No-op when
// NEXT_PUBLIC_SENTRY_DSN is unset (local dev has no Sentry project).
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment:
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? "development",
  tracesSampleRate: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT === "production" ? 0.2 : 1.0,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
