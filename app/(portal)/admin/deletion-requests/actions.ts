"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { portalActor } from "@/lib/auth/portal-actor";
import { hasPlatformRole } from "@/lib/auth/roles";
import { lookupAccountsByEmail, mergeAccountMatches, type AccountMatch } from "@/lib/avserv/account-lookup";
import { readShareLog } from "@/lib/avserv/share-log";
import { avservNodes } from "@/lib/avserv/sar-teams";
import { db } from "@/lib/db";
import { deletionRequests, sarOrgs, users } from "@/lib/db/schema";
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

export type AccountLookup =
  | { ok: true; status: "complete" | "incomplete" | "error"; matches: AccountMatch[]; unavailable: Array<{ node: string; code: string }> }
  | { ok: false; error: string };

/** AvAI accounts carrying a confirmed request's email (account_agreement.md
 *  §4.1). The address comes from the request row, never the browser. */
export async function lookupAccountsAction(_prev: AccountLookup | null, formData: FormData): Promise<AccountLookup> {
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  if (!(await hasPlatformRole(actor.userId, "rmdig_admin"))) {
    return { ok: false, error: "Only a platform administrator can look this up." };
  }
  const requestId = z.string().uuid().safeParse(formData.get("requestId"));
  if (!requestId.success) return { ok: false, error: "Unknown request." };
  const [request] = await db
    .select({ email: deletionRequests.email })
    .from(deletionRequests)
    .where(and(eq(deletionRequests.id, requestId.data), eq(deletionRequests.status, "confirmed")))
    .limit(1);
  if (!request) return { ok: false, error: "That request isn't in the confirmed queue." };

  const nodes = avservNodes();
  if (nodes.length === 0) {
    logger.error({ event: "deletion.account_lookup.no_avserv_nodes", requestId: requestId.data });
    return { ok: false, error: "No AvAI servers are configured, so this can't be looked up." };
  }
  const merged = mergeAccountMatches(await Promise.all(nodes.map((n) => lookupAccountsByEmail(n, request.email, actor.userId))));
  for (const u of merged.unavailable) {
    logger.error({ event: "deletion.account_lookup.node_failed", requestId: requestId.data, node: u.node, code: u.code });
  }
  logger.info({
    event: "deletion.account_lookup",
    requestId: requestId.data,
    staffId: actor.userId,
    status: merged.status,
    matches: merged.matches.length,
  });
  return { ok: true, ...merged };
}

export type MarkCompleted = { ok: true } | { ok: false; error: string };

const CompleteInput = z.object({
  requestId: z.string().uuid(),
  note: z.string().trim().min(10, "Say what was erased, and where (at least a short sentence).").max(2000),
});

/** Close a confirmed deletion request once the runbook's steps are done:
 *  what was erased and where, recorded with who did it and when. Replaces the
 *  production UPDATE the runbook used to need. */
export async function markDeletionCompletedAction(_prev: MarkCompleted | null, formData: FormData): Promise<MarkCompleted> {
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  if (!(await hasPlatformRole(actor.userId, "rmdig_admin"))) {
    return { ok: false, error: "Only a platform administrator can close a deletion request." };
  }
  const parsed = CompleteInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const { requestId, note } = parsed.data;
  const [staff] = await db.select({ email: users.email }).from(users).where(eq(users.id, actor.userId)).limit(1);
  const now = new Date();
  const updated = await db
    .update(deletionRequests)
    .set({ status: "completed", completedAt: now, note: `${note}\n— ${staff?.email ?? actor.userId}, ${now.toISOString()}` })
    .where(and(eq(deletionRequests.id, requestId), eq(deletionRequests.status, "confirmed")))
    .returning({ id: deletionRequests.id });
  if (updated.length === 0) return { ok: false, error: "That request isn't in the confirmed queue." };
  logger.info({ event: "deletion.completed", requestId, staffId: actor.userId });
  revalidatePath("/admin/deletion-requests");
  return { ok: true };
}
