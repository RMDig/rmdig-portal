import { runCron } from "@/lib/cron/run";
import { logger } from "@/lib/logger";
import { runNoAdminCheck } from "@/lib/sar/no-admin";

// Daily (vercel.json crons): email SAR approvers while any live team has no
// admin (plan 33 §6.4). Vercel calls it with "Authorization: Bearer
// <CRON_SECRET>"; anything else is 401.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return runCron(req, "sar_no_admin", async () => {
    const summary = await runNoAdminCheck();
    logger.info({ event: "cron.sar_no_admin.done", ...summary });
    // A failed email is logged per send; the run itself succeeded unless it threw.
    return { ok: true, body: summary };
  });
}
