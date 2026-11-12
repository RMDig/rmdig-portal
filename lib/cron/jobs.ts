// Every scheduled job: its route, its schedule and its Sentry cron monitor.
// vercel.json's "crons" must list exactly these (tests/unit/cron-jobs.test.ts
// holds them together), so a monitor never expects a run Vercel won't make.
//
// Daily jobs ("M H * * *") and, on Vercel Pro, every-N-minutes jobs
// ("*/N * * * *", plan 33 9.11): the two shapes lib/cron/schedule.ts parses,
// which also sets how late a run may be before the watch and the job's Sentry
// monitor call it missed.

export type CronJob =
  | "patrol_reverify"
  | "sar_retention"
  | "avserv_checks"
  | "sar_alert_notify"
  | "sar_node_check"
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
  // (lib/sar/alert-notify.ts). Every minute; each email waits longer between
  // tries (RETRY_DELAY_MINUTES).
  sar_alert_notify: { path: "/api/cron/sar-alert-notify", schedule: "* * * * *", monitorSlug: "portal-sar-alert-notify" },
  // Re-sends a team to a node whose sync failed, and reads every active
  // team's view on each node (lib/sar/node-check.ts; plan 33 9.11, F4).
  sar_node_check: { path: "/api/cron/sar-node-check", schedule: "*/5 * * * *", monitorSlug: "portal-sar-node-check" },
  deletion_clock: { path: "/api/cron/deletion-clock", schedule: "0 16 * * *", monitorSlug: "portal-deletion-clock" },
  // Opt-in security notices for changes made on the phones (AvServ's feed,
  // plan 36 §5.3). Every 10 minutes on Pro (owner S-D8).
  security_notices: { path: "/api/cron/security-notices", schedule: "*/10 * * * *", monitorSlug: "portal-security-notices" },
  // Sessions, tokens and rate-limit rows past use (lib/retention/expired-rows.ts).
  expired_rows: { path: "/api/cron/expired-rows", schedule: "0 10 * * *", monitorSlug: "portal-expired-rows" },
  // SAR teams left with no admin (lib/sar/no-admin.ts, plan 33 §6.4).
  sar_no_admin: { path: "/api/cron/sar-no-admin", schedule: "30 15 * * *", monitorSlug: "portal-sar-no-admin" },
  // Catches any job above that stopped running (lib/cron/watch.ts). Last of
  // the day, after every other job's margin has passed. Its monitor is the one
  // Sentry's free plan includes, so a watch that stops running is caught too.
  cron_watch: { path: "/api/cron/cron-watch", schedule: "30 19 * * *", monitorSlug: "portal-cron-watch" },
};

export const MONITOR_MAX_RUNTIME_MINUTES = 5;
