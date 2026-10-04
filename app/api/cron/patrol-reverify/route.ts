import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { runReverifyReminders } from "@/lib/sar/reverify-run";

// Daily (vercel.json crons): ski patrol re-verification reminders. Vercel
// calls it with "Authorization: Bearer <CRON_SECRET>"; anything else is 401.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(header: string | null, secret: string): boolean {
  const want = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header ?? "");
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function GET(req: Request) {
  if (!env.CRON_SECRET) {
    logger.error({ event: "cron.patrol_reverify.unconfigured" });
    return NextResponse.json({ code: "cron_not_configured" }, { status: 503 });
  }
  if (!authorized(req.headers.get("authorization"), env.CRON_SECRET)) {
    logger.warn({ event: "cron.patrol_reverify.unauthorized" });
    return NextResponse.json({ code: "unauthorized" }, { status: 401 });
  }
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
