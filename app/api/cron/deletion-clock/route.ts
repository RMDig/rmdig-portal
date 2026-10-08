import { runCron } from "@/lib/cron/run";
import { runDeletionClock } from "@/lib/deletion/clock";
import { logger } from "@/lib/logger";

// Daily (vercel.json crons): the Colorado Privacy Act 45-day clock on
// confirmed deletion requests (lib/deletion/clock.ts). Warns at 30 days,
// escalates at 40, in Sentry and by email to every rmdig admin.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return runCron(req, "deletion_clock", async () => {
    const summary = await runDeletionClock(new Date());
    logger.info({ event: "cron.deletion_clock.done", ...summary });
    return { ok: true, body: summary };
  });
}
