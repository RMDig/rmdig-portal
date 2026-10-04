"use server";

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { portalActor } from "@/lib/auth/portal-actor";
import { hasPlatformRole } from "@/lib/auth/roles";
import { readShareLog } from "@/lib/avserv/share-log";
import { avservNodes } from "@/lib/avserv/sar-teams";
import { db } from "@/lib/db";
import { deletionRequests, sarOrgs } from "@/lib/db/schema";
import { summarizeShareLog, type ShareLogSummary } from "@/lib/deletion/share-log";
import { logger } from "@/lib/logger";

// For a confirmed deletion request: which SAR teams AvAI sent this account's
// data to, read from every AvServ node (AvServ plan 41 §10.3). rmdig admins
// only, like the deletion emails. Read-only: it informs the operator's
// notices; it doesn't send any.

export type ShareLogLookup =
  | { ok: true; summary: ShareLogSummary; teamNames: Record<string, string> }
  | { ok: false; error: string };

const Input = z.object({ requestId: z.string().uuid(), accountId: z.string().uuid("Enter the AvAI account id (a UUID).") });

export async function lookupShareLogAction(_prev: ShareLogLookup | null, formData: FormData): Promise<ShareLogLookup> {
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  if (!(await hasPlatformRole(actor.userId, "rmdig_admin"))) {
    return { ok: false, error: "Only a platform administrator can look this up." };
  }
  const parsed = Input.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const { requestId, accountId } = parsed.data;

  const [request] = await db
    .select({ id: deletionRequests.id })
    .from(deletionRequests)
    .where(and(eq(deletionRequests.id, requestId), eq(deletionRequests.status, "confirmed")))
    .limit(1);
  if (!request) return { ok: false, error: "That request isn't in the confirmed queue." };

  const nodes = avservNodes();
  if (nodes.length === 0) {
    logger.error({ event: "deletion.share_log.no_avserv_nodes", requestId });
    return { ok: false, error: "No AvAI servers are configured, so this can't be looked up." };
  }
  const summary = summarizeShareLog(await Promise.all(nodes.map((n) => readShareLog(n, accountId))));
  for (const u of summary.unavailable) {
    logger.error({ event: "deletion.share_log.node_failed", requestId, node: u.node, code: u.code });
  }
  const ids = summary.teams.map((t) => t.teamId);
  const names = ids.length
    ? await db.select({ id: sarOrgs.id, name: sarOrgs.name }).from(sarOrgs).where(inArray(sarOrgs.id, ids))
    : [];
  logger.info({
    event: "deletion.share_log.lookup",
    requestId,
    staffId: actor.userId,
    status: summary.status,
    teams: summary.teams.length,
  });
  return { ok: true, summary, teamNames: Object.fromEntries(names.map((n) => [n.id, n.name])) };
}
