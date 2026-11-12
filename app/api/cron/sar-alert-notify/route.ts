import { runCron } from "@/lib/cron/run";
import { logger } from "@/lib/logger";
import { retryAlertNotifications } from "@/lib/sar/alert-notify";

// Every minute (vercel.json crons): retries SAR team emails still owed after
// the first attempt and the other node's copy (lib/sar/alert-notify.ts), each
// once its wait since the last try is up. Each email is given up loudly after
// MAX_ATTEMPTS. The run fails only if it can't read the queue; a failed email
// is reported where it fails.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return runCron(req, "sar_alert_notify", async () => {
    const summary = await retryAlertNotifications(new Date());
    logger.info({ event: "cron.sar_alert_notify.done", ...summary });
    return { ok: true, body: summary };
  });
}
