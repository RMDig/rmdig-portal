import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";

import { runAvServChecks } from "@/lib/avserv/checks";
import { avservNodes } from "@/lib/avserv/sar-teams";
import { cronAuthFailure } from "@/lib/cron/auth";
import { logger } from "@/lib/logger";

// Daily (vercel.json crons): the Admin → AvServ checks, without anyone
// clicking, so a broken signing key, a lost route group or a failing node is
// caught within a day. Reads as portal-user:cron and skips the email lookup
// (the one probe AvServ logs). Any failure answers 503 and goes to Sentry.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = cronAuthFailure(req, "avserv_checks");
  if (denied) return denied;
  if (avservNodes().length === 0) {
    logger.error({ event: "cron.avserv_checks.no_nodes" });
    return NextResponse.json({ code: "no_avserv_nodes" }, { status: 503 });
  }
  const results = await runAvServChecks("cron", { emailLookup: false });
  const failed = results.filter((r) => !r.ok).map((r) => `${r.node}: ${r.check}: ${r.answer}`);
  if (failed.length) {
    logger.error({ event: "cron.avserv_checks.failed", failed });
    Sentry.captureMessage(`AvServ checks failed: ${failed.join("; ")}`, "error");
    return NextResponse.json({ ok: false, failed, results }, { status: 503 });
  }
  logger.info({ event: "cron.avserv_checks.done", checks: results.length });
  return NextResponse.json({ ok: true, results });
}
