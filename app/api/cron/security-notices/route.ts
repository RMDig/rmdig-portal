import { runSecurityNotices } from "@/lib/auth/security-notices";
import { runCron } from "@/lib/cron/run";

// Daily (vercel.json crons): opt-in security notices for changes made on the
// phones, read from AvServ's security_events feed (lib/auth/security-notices.ts).
// A user whose read or email failed is reported and retried tomorrow.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return runCron(req, "security_notices", async () => {
    const summary = await runSecurityNotices(new Date());
    return { ok: summary.failed === 0, body: summary, status: 502 };
  });
}
