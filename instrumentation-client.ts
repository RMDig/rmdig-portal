import * as Sentry from "@sentry/nextjs";

import { scrubEvent } from "@/lib/sentry-scrub";

// Browser Sentry. Next loads instrumentation-client.ts on the client under
// Turbopack and webpack alike; the old sentry.client.config.ts was only
// picked up by webpack builds, so under Next 16's Turbopack build the browser
// SDK never started.
//
// Can't import lib/env — Zod is server-only here, and the client only needs
// public values. Read NEXT_PUBLIC_* directly (Vercel exposes its system
// variables under that prefix); everything else stays server-side.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  tracesSampleRate: 0.1,
  enabled: Boolean(dsn),
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
  sendDefaultPii: false,
  beforeSend: scrubEvent,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
