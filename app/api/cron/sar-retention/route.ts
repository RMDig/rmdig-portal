import { runCron } from "@/lib/cron/run";
import { logger } from "@/lib/logger";
import { runSarRetention } from "@/lib/sar/retention";

// Daily (vercel.json crons): retention for the portal's copy of SAR team
// alerts and its view logs (lib/sar/retention.ts).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return runCron(req, "sar_retention", async () => {
    const summary = await runSarRetention(new Date());
    logger.info({ event: "cron.sar_retention.done", ...summary });
    return { ok: true, body: summary };
  });
}
