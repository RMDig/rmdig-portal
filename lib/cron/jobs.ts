// Every scheduled job: its route, its schedule and its Sentry cron monitor.
// vercel.json's "crons" must list exactly these (tests/unit/cron-jobs.test.ts
// holds them together), so a monitor never expects a run Vercel won't make.
//
// Vercel's Hobby plan runs a cron at most once a day, at some point within
// the scheduled hour, so every schedule here is daily and each monitor allows
// a 90-minute margin before it calls a run missed.

export type CronJob = "patrol_reverify" | "sar_retention" | "avserv_checks" | "sar_alert_notify" | "deletion_clock";

export const CRON_JOBS: Record<CronJob, { path: string; schedule: string; monitorSlug: string }> = {
  patrol_reverify: { path: "/api/cron/patrol-reverify", schedule: "0 15 * * *", monitorSlug: "portal-patrol-reverify" },
  sar_retention: { path: "/api/cron/sar-retention", schedule: "30 9 * * *", monitorSlug: "portal-sar-retention" },
  avserv_checks: { path: "/api/cron/avserv-checks", schedule: "0 14 * * *", monitorSlug: "portal-avserv-checks" },
  // The backstop for SAR team emails the other node's copy didn't retry
  // (lib/sar/alert-notify.ts). Daily is the Hobby plan's limit.
  sar_alert_notify: { path: "/api/cron/sar-alert-notify", schedule: "0 12 * * *", monitorSlug: "portal-sar-alert-notify" },
  deletion_clock: { path: "/api/cron/deletion-clock", schedule: "0 16 * * *", monitorSlug: "portal-deletion-clock" },
};

export const MONITOR_CHECKIN_MARGIN_MINUTES = 90;
export const MONITOR_MAX_RUNTIME_MINUTES = 5;
