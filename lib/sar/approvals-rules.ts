import type { ApprovalItem, ApprovalListResult } from "../avserv/sar-approvals";

// [COUNSEL]: team-facing wording (plan 33 §6.9 F3; AvServ sar_terms.md §6 O3,
// the field list a team sees before any alert), for counsel's review before
// the first real team. A change here goes to counsel too.
// How a confirm-first team's approval list reads (plan 33 D4, 9.8). Pure.
//
// Every node lists the acceptances it holds. They are merged by acceptanceId,
// as the app merges covering (sar_terms.md §6 "What the app sees"): across
// nodes the entry with the latest decision wins, and no decision is older
// than any. A node that couldn't be read is named, never shown as an empty
// list: "nobody is waiting" is only said when every node said so.

export interface MergedApproval {
  acceptanceId: string;
  termsVersion: number;
  acceptedAt: string;
  userDisplayName: string | null;
  standing: ApprovalItem["standing"];
  /** When the decision behind `standing` was made; null when none stands
   *  (pending, or approved because it came before the switch). */
  decidedAt: string | null;
}

export interface MergedApprovals {
  items: MergedApproval[];
  /** Nodes that didn't answer, with why. */
  failed: Array<{ node: string; code: string }>;
  /** A node's list ran past what the portal reads. */
  truncated: boolean;
}

/** Team statuses AvServ holds, so a confirm-first team in one has approvals
 *  to decide and to be told about. */
export const APPROVALS_STATUSES = ["approved", "leaving", "suspended"] as const;
export const hasApprovals = (status: string) => (APPROVALS_STATUSES as readonly string[]).includes(status);

const decidedMs = (i: ApprovalItem) => (i.decision ? Date.parse(i.decision.at) : -Infinity);

export function mergeApprovals(lists: Array<{ node: string; result: ApprovalListResult }>): MergedApprovals {
  const byId = new Map<string, { item: ApprovalItem; name: string | null }>();
  const failed: MergedApprovals["failed"] = [];
  let truncated = false;
  for (const { node, result } of lists) {
    if (!result.ok) {
      failed.push({ node, code: result.code });
      continue;
    }
    truncated ||= result.truncated;
    for (const item of result.items) {
      const seen = byId.get(item.acceptanceId);
      if (!seen) {
        byId.set(item.acceptanceId, { item, name: item.userDisplayName });
        continue;
      }
      // The latest decision wins; a node that hasn't seen it yet says pending.
      const winner = decidedMs(item) > decidedMs(seen.item) ? item : seen.item;
      byId.set(item.acceptanceId, { item: winner, name: seen.name ?? item.userDisplayName });
    }
  }
  const order = { pending: 0, approved: 1, declined: 2 } as const;
  const items = [...byId.values()]
    .map(({ item, name }) => ({
      acceptanceId: item.acceptanceId,
      termsVersion: item.termsVersion,
      acceptedAt: item.acceptedAt,
      userDisplayName: name,
      standing: item.standing,
      decidedAt: item.decision?.at ?? null,
    }))
    .sort((a, b) => order[a.standing] - order[b.standing] || Date.parse(a.acceptedAt) - Date.parse(b.acceptedAt));
  return { items, failed, truncated };
}

/** What a request's standing means, in the team's words. */
export function standingText(m: Pick<MergedApproval, "standing" | "decidedAt">): string {
  if (m.standing === "pending") return "Waiting for your team";
  if (m.standing === "declined") return "Declined";
  return m.decidedAt ? "Approved" : "Approved: accepted before your team turned on approvals";
}

/** The decision buttons a request offers: decide a pending one, or reverse
 *  one already decided. */
export function decisionsFor(standing: ApprovalItem["standing"]): Array<{ state: "approved" | "declined"; label: string }> {
  if (standing === "pending") return [{ state: "approved", label: "Approve" }, { state: "declined", label: "Decline" }];
  if (standing === "approved") return [{ state: "declined", label: "Withdraw approval" }];
  return [{ state: "approved", label: "Approve" }];
}

/** A failed decision's code, as the team reads it. */
export function decideErrorText(code: string): string {
  if (code === "acceptance_revoked") return "This person has withdrawn their acceptance of your terms, so there's nothing to decide.";
  if (code === "team_not_confirm_first") return "AvAI's servers don't have your team as approving users first yet. Reload in a few minutes.";
  if (code === "sar_capture_unavailable") return "AvAI's servers can't record decisions right now. Try again in a few minutes.";
  if (code === "acceptance_unknown") return "No AvAI server knows this request any more. Reload the list.";
  return `AvAI's servers didn't record the decision (${code}). Try again in a few minutes.`;
}
