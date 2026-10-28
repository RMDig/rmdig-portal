import { runCron } from "@/lib/cron/run";
import { logger } from "@/lib/logger";
import { deleteExpiredRows } from "@/lib/retention/expired-rows";

// Daily (vercel.json crons): deletes sessions, tokens, unconfirmed deletion
// requests and rate-limit rows past use (lib/retention/expired-rows.ts).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return runCron(req, "expired_rows", async () => {
    const summary = await deleteExpiredRows(new Date());
    logger.info({ event: "cron.expired_rows.done", ...summary });
    return { ok: true, body: summary };
  });
}
