import { NextResponse } from "next/server";

import { cronAuthFailure } from "@/lib/cron/auth";
import { logger } from "@/lib/logger";
import { runSarRetention } from "@/lib/sar/retention";

// Daily (vercel.json crons): retention for the portal's copy of SAR team
// alerts and its view logs (lib/sar/retention.ts).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = cronAuthFailure(req, "sar_retention");
  if (denied) return denied;
  try {
    const summary = await runSarRetention(new Date());
    logger.info({ event: "cron.sar_retention.done", ...summary });
    return NextResponse.json(summary);
  } catch (err) {
    logger.error({ event: "cron.sar_retention.failed", err });
    return NextResponse.json({ code: "run_failed" }, { status: 500 });
  }
}
