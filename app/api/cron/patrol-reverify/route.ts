import { NextResponse } from "next/server";

import { cronAuthFailure } from "@/lib/cron/auth";
import { logger } from "@/lib/logger";
import { runReverifyReminders } from "@/lib/sar/reverify-run";

// Daily (vercel.json crons): ski patrol re-verification reminders. Vercel
// calls it with "Authorization: Bearer <CRON_SECRET>"; anything else is 401.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = cronAuthFailure(req, "patrol_reverify");
  if (denied) return denied;
  try {
    const summary = await runReverifyReminders(new Date());
    logger.info({ event: "cron.patrol_reverify.done", ...summary });
    // A failed email is logged per send; the run itself succeeded unless it threw.
    return NextResponse.json(summary);
  } catch (err) {
    logger.error({ event: "cron.patrol_reverify.failed", err });
    return NextResponse.json({ code: "run_failed" }, { status: 500 });
  }
}
