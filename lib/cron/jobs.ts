// Every scheduled job: its route, its schedule and its Sentry cron monitor.
// vercel.json's "crons" must list exactly these (tests/unit/cron-jobs.test.ts
// holds them together), so a monitor never expects a run Vercel won't make.
//
// Vercel's Hobby plan runs a cron at most once a day, at some point within
// the scheduled hour, so every schedule here is daily and each monitor allows
// a 90-minute margin before it calls a run missed.

export type CronJob =
  | "patrol_reverify"
  | "sar_retention"
  | "avserv_checks"
  | "sar_alert_notify"
  | "deletion_clock"
  | "security_notices"
  | "expired_rows"
  | "sar_no_admin"
  | "cron_watch";

export const CRON_JOBS: Record<CronJob, { path: string; schedule: string; monitorSlug: string }> = {
  patrol_reverify: { path: "/api/cron/patrol-reverify", schedule: "0 15 * * *", monitorSlug: "portal-patrol-reverify" },
  sar_retention: { path: "/api/cron/sar-retention", schedule: "30 9 * * *", monitorSlug: "portal-sar-retention" },
  avserv_checks: { path: "/api/cron/avserv-checks", schedule: "0 14 * * *", monitorSlug: "portal-avserv-checks" },
  // The backstop for SAR team emails the other node's copy didn't retry
  // (lib/sar/alert-notify.ts). Daily is the Hobby plan's limit.
  sar_alert_notify: { path: "/api/cron/sar-alert-notify", schedule: "0 12 * * *", monitorSlug: "portal-sar-alert-notify" },
  deletion_clock: { path: "/api/cron/deletion-clock", schedule: "0 16 * * *", monitorSlug: "portal-deletion-clock" },
  // Opt-in security notices for changes made on the phones (AvServ's feed,
  // plan 36 §5.3). Daily on Hobby (owner S-D8); every 10 minutes after Pro.
  security_notices: { path: "/api/cron/security-notices", schedule: "0 17 * * *", monitorSlug: "portal-security-notices" },
  // Sessions, tokens and rate-limit rows past use (lib/retention/expired-rows.ts).
  expired_rows: { path: "/api/cron/expired-rows", schedule: "0 10 * * *", monitorSlug: "portal-expired-rows" },
  // SAR teams left with no admin (lib/sar/no-admin.ts, plan 33 §6.4).
  sar_no_admin: { path: "/api/cron/sar-no-admin", schedule: "30 15 * * *", monitorSlug: "portal-sar-no-admin" },
  // Catches any job above that stopped running (lib/cron/watch.ts). Last of
  // the day, after every other job's margin has passed. Its monitor is the one
  // Sentry's free plan includes, so a watch that stops running is caught too.
  cron_watch: { path: "/api/cron/cron-watch", schedule: "30 19 * * *", monitorSlug: "portal-cron-watch" },
};

export const MONITOR_CHECKIN_MARGIN_MINUTES = 90;
export const MONITOR_MAX_RUNTIME_MINUTES = 5;
