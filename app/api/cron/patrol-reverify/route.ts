import { runCron } from "@/lib/cron/run";
import { logger } from "@/lib/logger";
import { runReverifyReminders } from "@/lib/sar/reverify-run";

// Daily (vercel.json crons): ski patrol re-verification reminders. Vercel
// calls it with "Authorization: Bearer <CRON_SECRET>"; anything else is 401.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return runCron(req, "patrol_reverify", async () => {
    const summary = await runReverifyReminders(new Date());
    logger.info({ event: "cron.patrol_reverify.done", ...summary });
    // A failed email is reported per send; the run itself succeeded unless it threw.
    return { ok: true, body: summary };
  });
}
