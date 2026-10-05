"use server";

import { portalActor } from "@/lib/auth/portal-actor";
import { hasPlatformRole } from "@/lib/auth/roles";
import { avservNodes } from "@/lib/avserv/sar-teams";
import { runAvServChecks, type CheckResult } from "@/lib/avserv/checks";
import { logger } from "@/lib/logger";

export type ChecksOutcome = { ok: true; results: CheckResult[]; at: string } | { ok: false; error: string };

export async function runChecksAction(_prev: ChecksOutcome | null, _fd: FormData): Promise<ChecksOutcome> {
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  if (!(await hasPlatformRole(actor.userId, "rmdig_admin"))) {
    return { ok: false, error: "Only a platform administrator can run these checks." };
  }
  if (avservNodes().length === 0) {
    logger.error({ event: "avserv.checks.no_nodes" });
    return { ok: false, error: "No AvAI servers are configured (AVSERV_BASE_URL / AVSERV_FAILOVER_BASE_URL)." };
  }
  const results = await runAvServChecks(actor.userId);
  const failed = results.filter((r) => !r.ok);
  const event = { event: "avserv.checks.run", staffId: actor.userId, failed: failed.map((f) => `${f.node}:${f.check}:${f.answer}`) };
  if (failed.length) logger.error(event);
  else logger.info(event);
  return { ok: true, results, at: new Date().toISOString() };
}
