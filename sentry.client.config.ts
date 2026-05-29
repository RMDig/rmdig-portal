import * as Sentry from "@sentry/nextjs";

// Client config can't import lib/env directly — Zod is server-only here, and
// the client only needs the public DSN. Read NEXT_PUBLIC_* directly; everything
// else stays server-side.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  tracesSampleRate: 0.1,
  enabled: Boolean(dsn),
});
