import * as Sentry from "@sentry/nextjs";

// Reads process.env directly instead of lib/env ON PURPOSE. This file is
// bundled into the Edge middleware, so an import of lib/env would make every
// request on every route throw whenever ANY required server secret is missing
// — the middleware dies before a single page can render (observed in prod as
// MIDDLEWARE_INVOCATION_FAILED, 2026-07-22). The edge runtime needs exactly
// one value; strict env validation stays a Node-server-boot concern.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  enabled: Boolean(process.env.SENTRY_DSN),
});
