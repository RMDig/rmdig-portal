import { describe, expect, it } from "vitest";

import type { ApprovalSummaryResult } from "@/lib/avserv/sar-approvals";
import { approvalNotifyPlan, type NodeSummary } from "@/lib/sar/approval-notify-rules";

// When a confirm-first team's admins are told someone is waiting (plan 33
// 9.8; AvServ sar_terms.md §6a): the newest pending acceptance across the
// nodes that answered, later than the last one they were emailed about.

const ok = (pending: number, newest: string | null): ApprovalSummaryResult => ({ ok: true, pending, newestPendingAcceptedAt: newest });
const no = (code: string, status?: number): ApprovalSummaryResult => ({ ok: false, status, code });
const nodes = (a: ApprovalSummaryResult, b: ApprovalSummaryResult): NodeSummary[] => [
  { node: "avserv-2", result: a },
  { node: "avserv-3", result: b },
];

describe("approvalNotifyPlan", () => {
  it("emails for the newest pending acceptance on either node, never summing them", () => {
    const plan = approvalNotifyPlan(nodes(ok(1, "2026-11-12T10:00:00Z"), ok(2, "2026-11-12T11:00:00Z")), null);
    expect(plan).toEqual({ kind: "notify", through: new Date("2026-11-12T11:00:00Z"), failed: [] });
  });

  it("emails again only for something newer than the last email", () => {
    const last = new Date("2026-11-12T11:00:00Z");
    expect(approvalNotifyPlan(nodes(ok(1, "2026-11-12T11:00:00Z"), ok(0, null)), last).kind).toBe("none");
    expect(approvalNotifyPlan(nodes(ok(1, "2026-11-12T10:00:00Z"), ok(0, null)), last).kind).toBe("none");
    expect(approvalNotifyPlan(nodes(ok(2, "2026-11-12T11:00:00.001Z"), ok(0, null)), last)).toMatchObject({ kind: "notify" });
  });

  it("compares to the millisecond, so AvServ's nanoseconds never email the team every run", () => {
    const first = approvalNotifyPlan(nodes(ok(1, "2026-11-12T10:00:00.123456789Z"), ok(0, null)), null);
    expect(first).toMatchObject({ kind: "notify", through: new Date("2026-11-12T10:00:00.123Z") });
    const stored = first.kind === "notify" ? first.through : null;
    expect(approvalNotifyPlan(nodes(ok(1, "2026-11-12T10:00:00.123456789Z"), ok(0, null)), stored).kind).toBe("none");
  });

  it("says nothing when nobody waits", () => {
    expect(approvalNotifyPlan(nodes(ok(0, null), ok(0, null)), null)).toEqual({ kind: "none", failed: [] });
  });

  it("lets the node that answered decide, and names the one that didn't", () => {
    expect(approvalNotifyPlan(nodes(no("unreachable"), ok(1, "2026-11-12T10:00:00Z")), null)).toEqual({
      kind: "notify",
      through: new Date("2026-11-12T10:00:00Z"),
      failed: [{ node: "avserv-2", code: "unreachable" }],
    });
    expect(approvalNotifyPlan(nodes(no("approvals_unavailable", 503), ok(0, null)), null)).toEqual({
      kind: "none",
      failed: [{ node: "avserv-2", code: "approvals_unavailable" }],
    });
  });

  it("reads a node that doesn't hold the team, or not as confirm-first yet, as nobody waiting there", () => {
    expect(approvalNotifyPlan(nodes(no("team_not_confirm_first", 422), no("sar_team_unknown", 404)), null)).toEqual({ kind: "none", failed: [] });
  });

  it("is unread when no node could say, and a bad time counts as no answer", () => {
    expect(approvalNotifyPlan(nodes(no("unreachable"), no("path_not_allowed", 403)), null)).toMatchObject({ kind: "unread" });
    expect(approvalNotifyPlan(nodes(ok(1, "yesterday"), no("unreachable")), null)).toEqual({
      kind: "unread",
      failed: [
        { node: "avserv-2", code: "bad_time" },
        { node: "avserv-3", code: "unreachable" },
      ],
    });
  });
});
