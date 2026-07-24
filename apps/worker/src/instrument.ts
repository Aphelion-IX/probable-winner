import * as Sentry from "@sentry/node";

// B-200: worker error and performance monitoring. Must be imported before
// any other module (per Sentry Node SDK requirement) so it can instrument
// subsequent imports. No-op when SENTRY_DSN is unset (local dev).
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? "development",
  tracesSampleRate: process.env.SENTRY_ENVIRONMENT === "production" ? 0.2 : 1.0,
  enabled: Boolean(process.env.SENTRY_DSN),
});
