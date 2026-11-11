import { runCron } from "@/lib/cron/run";
import { runCronWatch } from "@/lib/cron/watch";
import { logger } from "@/lib/logger";

// Daily (vercel.json crons), last of the day: catch any scheduled job that
// stopped running (lib/cron/watch.ts). A late job fails this run, so its
// monitor (portal-cron-watch) alerts as well as the email and the issue.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return runCron(req, "cron_watch", async () => {
    const summary = await runCronWatch();
    logger.info({ event: "cron.cron_watch.done", ...summary });
    return { ok: summary.late.length === 0, body: summary };
  });
}
