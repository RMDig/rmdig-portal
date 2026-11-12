import { runCron } from "@/lib/cron/run";
import { runNodeCheck } from "@/lib/sar/node-check";

// Every 5 minutes (vercel.json crons): send a team again to any AvServ node
// that doesn't hold it as last sent, and read every active team's view on
// each node (lib/sar/node-check.ts; plan 33 9.11). A team that still fails is
// reported where it fails; the run fails only on a crash, so its monitor and
// the cron watch see a job that stopped working.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return runCron(req, "sar_node_check", async () => {
    const summary = await runNodeCheck(new Date());
    return { ok: summary.crashed === 0, body: summary, status: 503 };
  });
}
