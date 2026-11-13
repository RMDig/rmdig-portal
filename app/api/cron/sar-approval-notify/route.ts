import { runCron } from "@/lib/cron/run";
import { logger } from "@/lib/logger";
import { runApprovalNotify } from "@/lib/sar/approval-notify";

// Every 5 minutes (vercel.json crons): email a confirm-first team's admins
// when someone new waits for approval (plan 33 9.8). Vercel calls it with
// "Authorization: Bearer <CRON_SECRET>"; anything else is 401.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return runCron(req, "sar_approval_notify", async () => {
    const summary = await runApprovalNotify();
    logger.info({ event: "cron.sar_approval_notify.done", ...summary });
    // A failed email or node is logged and reported; the run itself succeeded unless it threw.
    return { ok: true, body: summary };
  });
}
