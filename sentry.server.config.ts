import * as Sentry from "@sentry/nextjs";

import { env } from "@/lib/env";

Sentry.init({
  dsn: env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  enabled: Boolean(env.SENTRY_DSN),
});
