import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { env } from "../env";
import { logger } from "../logger";
import { reportProblem } from "../report-error";

// Vercel calls scheduled routes (vercel.json crons) with
// "Authorization: Bearer <CRON_SECRET>". Returns the response to send when the
// call isn't authorized, or null to go ahead. Unset CRON_SECRET is a 503
// reported to Sentry: every scheduled job is silently not running.
export function cronAuthFailure(req: Request, job: string): NextResponse | null {
  if (!env.CRON_SECRET) {
    reportProblem(`cron.${job}.unconfigured`, "CRON_SECRET is not set: scheduled jobs are refused (503)");
    return NextResponse.json({ code: "cron_not_configured" }, { status: 503 });
  }
  const want = Buffer.from(`Bearer ${env.CRON_SECRET}`);
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  if (got.length !== want.length || !timingSafeEqual(got, want)) {
    logger.warn({ event: `cron.${job}.unauthorized` });
    return NextResponse.json({ code: "unauthorized" }, { status: 401 });
  }
  return null;
}
