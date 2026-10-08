import * as Sentry from "@sentry/nextjs";

import { scrubEvent } from "@/lib/sentry-scrub";

// Reads process.env directly instead of lib/env ON PURPOSE. This file is
// bundled into the Edge middleware, so an import of lib/env would make every
// request on every route throw whenever ANY required server secret is missing
// — the middleware dies before a single page can render (observed in prod as
// MIDDLEWARE_INVOCATION_FAILED, 2026-07-22). The edge runtime needs only these
// optional values; strict env validation stays a Node-server-boot concern.
// lib/sentry-scrub is env-free for the same reason.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  enabled: Boolean(process.env.SENTRY_DSN),
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  release: process.env.VERCEL_GIT_COMMIT_SHA,
  sendDefaultPii: false,
  beforeSend: scrubEvent,
});
