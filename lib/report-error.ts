import * as Sentry from "@sentry/nextjs";

import { logger } from "./logger";

// A failure nobody is waiting on (a cron, an email fan-out, a background
// notify) reaches pino only, which nobody watches. These send it to Sentry as
// well, which pages. `event` is the pino event name and the Sentry tag, so
// the two can be matched up. The context goes to both; Sentry's beforeSend
// (lib/sentry-scrub.ts) masks email addresses in it.

export function reportError(event: string, err: unknown, context: Record<string, unknown> = {}): void {
  logger.error({ event, ...context, err });
  Sentry.captureException(err, { tags: { event }, extra: context });
}

/** A condition that is wrong but not an exception (no admins to notify, a
 *  clock running out). `level` "warning" for something to look at today,
 *  "error" for something already broken or overdue. */
export function reportProblem(
  event: string,
  message: string,
  context: Record<string, unknown> = {},
  level: "warning" | "error" = "error",
): void {
  if (level === "warning") logger.warn({ event, ...context, message });
  else logger.error({ event, ...context, message });
  Sentry.captureMessage(message, { level, tags: { event }, extra: context });
}
