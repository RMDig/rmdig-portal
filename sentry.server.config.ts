import * as Sentry from "@sentry/nextjs";

import { env } from "@/lib/env";
import { scrubEvent } from "@/lib/sentry-scrub";

// environment separates production from preview noise; release ties an issue
// to the commit (the same SHA /healthz reports).
Sentry.init({
  dsn: env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  enabled: Boolean(env.SENTRY_DSN),
  environment: env.VERCEL_ENV ?? env.NODE_ENV,
  release: env.VERCEL_GIT_COMMIT_SHA ?? env.GIT_COMMIT_SHA,
  sendDefaultPii: false,
  beforeSend: scrubEvent,
});
