import { eq, inArray, sql } from "drizzle-orm";

import { avservNodes } from "../avserv/sar-teams";
import { db } from "../db";
import { sarOrgs, sarOrgSync } from "../db/schema";
import { logger } from "../logger";
import { reportError, reportProblem } from "../report-error";
import { readTeamRecovery } from "./recovery";
import { DRILL_REFUSALS, syncSarOrg } from "./sync";

// Every five minutes (plan 33 9.11; the sar-node-check cron). Two things a
// sync alone can't promise:
//
// 1. A team a node doesn't hold as the portal last sent it is sent again: a
//    failed PUT, a node that says "resync" (sar_team_sync.md §5.4), or a node
//    added to AVSERV_NODE_URLS after the team was synced. syncSarOrg sends to
//    every node with a new revision, which a node that already has the team
//    simply applies. A drill refusal is never retried: a person looks at it.
// 2. Every active team's view on each node is read (lib/sar/recovery.ts), so
//    a problem that starts between syncs, such as an on-call email that starts
//    bouncing, reaches the team's banner and its admins within minutes.
//
// One team failing never stops the others; a node still failing an hour after
// its last success is reported.

export const RESYNC_BATCH = 20;
export const READ_BATCH = 50;
const READ_CONCURRENCY = 4;
export const FAILING_REPORT_MS = 60 * 60_000;

export interface SyncRow {
  orgId: string;
  node: string;
  outcome: "ok" | "error" | "skipped";
  errorCode: string | null;
  remedy: string | null;
  attemptedAt: Date;
  syncedAt: Date | null;
}

/** The teams owed a resend, longest-waiting first. `nodes`: the configured
 *  node names. A node with no row is owed only if another node holds the
 *  team, so a team that was never sent anywhere (pending, or skipped for want
 *  of terms) stays with the sync that skipped it. */
export function owedResyncs(rows: SyncRow[], nodes: string[]): string[] {
  const byOrg = new Map<string, SyncRow[]>();
  for (const r of rows) byOrg.set(r.orgId, [...(byOrg.get(r.orgId) ?? []), r]);
  const owed: Array<{ orgId: string; since: number }> = [];
  for (const [orgId, orgRows] of byOrg) {
    const held = orgRows.some((r) => r.outcome === "ok");
    let since = Infinity;
    for (const node of nodes) {
      const r = orgRows.find((x) => x.node === node);
      const due = r
        ? (r.outcome === "error" && !DRILL_REFUSALS.has(r.errorCode ?? "")) || (r.outcome === "ok" && r.remedy === "resync")
        : held;
      if (due) since = Math.min(since, r?.attemptedAt.getTime() ?? 0);
    }
    if (since !== Infinity) owed.push({ orgId, since });
  }
  return owed.sort((a, b) => a.since - b.since).map((o) => o.orgId);
}

export interface NodeCheckSummary {
  owed: number;
  resynced: number;
  stillFailing: number;
  crashed: number;
  read: number;
  readFailed: number;
}

export async function runNodeCheck(now: Date = new Date()): Promise<NodeCheckSummary> {
  const nodes = avservNodes().map((n) => n.name);
  if (nodes.length === 0) throw new Error("runNodeCheck: no AvServ nodes are configured");
  const rows: SyncRow[] = await db
    .select({
      orgId: sarOrgSync.orgId,
      node: sarOrgSync.node,
      outcome: sarOrgSync.outcome,
      errorCode: sarOrgSync.errorCode,
      remedy: sarOrgSync.remedy,
      attemptedAt: sarOrgSync.attemptedAt,
      syncedAt: sarOrgSync.syncedAt,
    })
    .from(sarOrgSync);
  const owed = owedResyncs(rows, nodes);
  const summary: NodeCheckSummary = { owed: owed.length, resynced: 0, stillFailing: 0, crashed: 0, read: 0, readFailed: 0 };

  // syncSarOrg reads every node's view after it sends, so these are read too.
  const done = new Set<string>();
  for (const orgId of owed.slice(0, RESYNC_BATCH)) {
    done.add(orgId);
    try {
      const outcomes = await syncSarOrg(orgId);
      summary.resynced++;
      for (const o of outcomes) {
        if (o.outcome !== "error") continue;
        summary.stillFailing++;
        const lastOk = rows.find((r) => r.orgId === orgId && r.node === o.node)?.syncedAt ?? null;
        if (!lastOk || now.getTime() - lastOk.getTime() > FAILING_REPORT_MS) {
          reportProblem("sar.sync.retry_failing", "An AvServ node still refuses or can't be reached for a SAR team", {
            orgId,
            node: o.node,
            code: o.code,
            lastSyncedAt: lastOk?.toISOString() ?? "never",
          });
        }
      }
    } catch (err) {
      summary.crashed++;
      reportError("sar.node_check.resync_crashed", err, { orgId });
    }
  }

  // Then the active teams not just read, least recently read first.
  const active = await db
    .select({ id: sarOrgs.id })
    .from(sarOrgs)
    .leftJoin(sarOrgSync, eq(sarOrgSync.orgId, sarOrgs.id))
    .where(inArray(sarOrgs.status, ["approved", "leaving"]))
    .groupBy(sarOrgs.id)
    .orderBy(sql`min(${sarOrgSync.viewReadAt}) ASC NULLS FIRST`)
    .limit(READ_BATCH + done.size);
  const toRead = active.map((a) => a.id).filter((id) => !done.has(id)).slice(0, READ_BATCH);
  for (let i = 0; i < toRead.length; i += READ_CONCURRENCY) {
    const reads = await Promise.all(toRead.slice(i, i + READ_CONCURRENCY).map((orgId) => readTeamRecovery(orgId)));
    for (const r of reads) {
      summary.read++;
      if (r.length === 0 || r.some((n) => n.error !== null)) summary.readFailed++;
    }
  }
  logger.info({ event: "sar.node_check.done", ...summary });
  return summary;
}
