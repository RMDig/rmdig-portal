import type { ApprovalSummaryResult } from "../avserv/sar-approvals";

// When a confirm-first team's admins are told someone is waiting (plan 33
// 9.8; AvServ sar_terms.md §6a). Pure.
//
// Each node reports its own newest pending acceptance. They are never summed
// (an acceptance can be on both), so the email says only that people are
// waiting, never how many. The team is emailed when the newest across the
// nodes that answered is later than the newest it was emailed about. Times
// are compared to the millisecond: AvServ's carry nanoseconds, and a stored
// time a little earlier than the node's would email the team every run.

export type NodeSummary = { node: string; result: ApprovalSummaryResult };

export type NotifyPlan =
  /** Email the admins, then record `through`. */
  | { kind: "notify"; through: Date; failed: Array<{ node: string; code: string }> }
  /** Nothing newer than the last email, on every node that answered. */
  | { kind: "none"; failed: Array<{ node: string; code: string }> }
  /** No node could say. */
  | { kind: "unread"; failed: Array<{ node: string; code: string }> };

// AvServ doesn't have the team yet, or doesn't have it as confirm-first yet
// (the sync is held, or still on its way): it holds no request for it, so the
// node answered "nobody", not "can't say".
const NOTHING_HELD = new Set(["sar_team_unknown", "team_not_confirm_first"]);

export function approvalNotifyPlan(summaries: NodeSummary[], notifiedThrough: Date | null): NotifyPlan {
  let answered = 0;
  let newest: number | null = null;
  const failed: Array<{ node: string; code: string }> = [];
  for (const { node, result } of summaries) {
    if (!result.ok) {
      if (NOTHING_HELD.has(result.code)) answered++;
      else failed.push({ node, code: result.code });
      continue;
    }
    if (result.pending === 0 || result.newestPendingAcceptedAt === null) {
      answered++;
      continue;
    }
    const ms = Date.parse(result.newestPendingAcceptedAt);
    if (Number.isNaN(ms)) {
      failed.push({ node, code: "bad_time" });
      continue;
    }
    answered++;
    newest = newest === null ? ms : Math.max(newest, ms);
  }
  if (answered === 0) return { kind: "unread", failed };
  if (newest !== null && (notifiedThrough === null || newest > notifiedThrough.getTime())) {
    return { kind: "notify", through: new Date(newest), failed };
  }
  return { kind: "none", failed };
}
