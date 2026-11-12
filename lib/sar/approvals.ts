import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import { decideApproval, listApprovalRequests } from "../avserv/sar-approvals";
import { avservNodes } from "../avserv/sar-teams";
import { db } from "../db";
import { sarApprovalDecisions } from "../db/schema";
import { logger } from "../logger";
import { reportProblem } from "../report-error";
import { mergeApprovals, type MergedApprovals } from "./approvals-rules";

// A confirm-first team's approvals (plan 33 D4, 9.8; AvServ sar_terms.md §6):
// the list, read from every node and merged, and a decision, sent to every
// node. AvServ replicates decisions between nodes, so one node taking it is
// enough; the others are told too so a lagging one doesn't wait for
// replication.

/** Every node's list, merged. `readerUserId` is the team member reading: each
 *  node logs the read as a disclosure to them before it answers. */
export async function readApprovals(orgId: string, readerUserId: string): Promise<MergedApprovals & { nodes: number }> {
  const nodes = avservNodes();
  const lists = await Promise.all(nodes.map(async (node) => ({ node: node.name, result: await listApprovalRequests(node, orgId, readerUserId, "all") })));
  for (const l of lists) {
    if (!l.result.ok) logger.error({ event: "sar.approvals.read_failed", orgId, node: l.node, status: l.result.status, code: l.result.code });
  }
  const merged = mergeApprovals(lists);
  if (merged.truncated) reportProblem("sar.approvals.truncated", "A team's approval list ran past what the portal reads", { orgId });
  return { ...merged, nodes: nodes.length };
}

export type DecideOutcome = { ok: true } | { ok: false; code: string };

// When no node took the decision, the code that says most about why: a
// refusal that stands everywhere first, an unknown acceptance (which one node
// may simply not have yet) last.
const CODE_ORDER = ["acceptance_revoked", "team_not_confirm_first", "sar_capture_unavailable"];
const rank = (code: string) => {
  const i = CODE_ORDER.indexOf(code);
  return i >= 0 ? i : code === "acceptance_unknown" ? CODE_ORDER.length + 1 : CODE_ORDER.length;
};

/** Record and send one decision. The row is written first, so a decision
 *  asked for is never lost, then each node's answer is added to it. */
export async function decideAcceptance(orgId: string, acceptanceId: string, state: "approved" | "declined", userId: string): Promise<DecideOutcome> {
  const nodes = avservNodes();
  if (nodes.length === 0) {
    logger.error({ event: "sar.approvals.no_avserv_nodes", orgId });
    return { ok: false, code: "no_avserv_nodes" };
  }
  const idempotencyKey = randomUUID();
  const [row] = await db
    .insert(sarApprovalDecisions)
    .values({ orgId, acceptanceId, state, decidedByUserId: userId, idempotencyKey })
    .returning({ id: sarApprovalDecisions.id });

  const results = await Promise.all(
    nodes.map(async (node) => {
      const r = await decideApproval(node, orgId, acceptanceId, { state, by: `portal-user:${userId}` }, idempotencyKey);
      return r.ok ? { node: node.name, ok: true, decidedAt: r.decidedAt } : { node: node.name, ok: false, code: r.code };
    }),
  );
  await db.update(sarApprovalDecisions).set({ nodeResults: results }).where(eq(sarApprovalDecisions.id, row!.id));

  const failed = results.filter((r) => !r.ok);
  if (failed.length === results.length) {
    const code = failed.map((f) => f.code ?? "unknown").sort((a, b) => rank(a) - rank(b))[0]!;
    logger.error({ event: "sar.approvals.decision_failed", orgId, acceptanceId, state, userId, results });
    return { ok: false, code };
  }
  if (failed.length) logger.warn({ event: "sar.approvals.decision_partial", orgId, acceptanceId, state, userId, results });
  logger.info({ event: "sar.approvals.decided", orgId, acceptanceId, state, userId, nodes: results.length - failed.length });
  return { ok: true };
}
