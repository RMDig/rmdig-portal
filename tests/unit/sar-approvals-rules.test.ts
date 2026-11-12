import { describe, expect, it } from "vitest";

import type { ApprovalItem } from "@/lib/avserv/sar-approvals";
import { decideErrorText, decisionsFor, mergeApprovals, standingText } from "@/lib/sar/approvals-rules";
import { FORBIDDEN_PUBLIC_PHRASES } from "@/lib/legal/compliance-copy";

// A confirm-first team's approval list (plan 33 D4, 9.8; AvServ sar_terms.md
// §6): merged across nodes by acceptanceId, the latest decision winning, and a
// node that didn't answer named, never read as an empty list.

const item = (o: Partial<ApprovalItem> = {}): ApprovalItem => ({
  acceptanceId: "acc-1",
  termsVersion: 3,
  acceptedAt: "2026-11-10T10:00:00Z",
  userDisplayName: "John Doe",
  standing: "pending",
  decision: null,
  ...o,
});
const ok = (items: ApprovalItem[]) => ({ ok: true as const, items, truncated: false });
const decided = (state: "approved" | "declined", at: string) => ({ standing: state, decision: { state, at, by: "portal-user:a" } });

describe("mergeApprovals", () => {
  it("merges both nodes' copies of one acceptance into one row", () => {
    const m = mergeApprovals([
      { node: "avserv-2", result: ok([item()]) },
      { node: "avserv-3", result: ok([item()]) },
    ]);
    expect(m).toEqual({
      items: [{ acceptanceId: "acc-1", termsVersion: 3, acceptedAt: "2026-11-10T10:00:00Z", userDisplayName: "John Doe", standing: "pending", decidedAt: null }],
      failed: [],
      truncated: false,
    });
  });

  it("takes the latest decision across nodes, whichever node holds it, and a decision over pending", () => {
    const early = item(decided("approved", "2026-11-11T09:00:00Z"));
    const late = item(decided("declined", "2026-11-11T09:00:01.5Z"));
    for (const [a, b] of [[early, late], [late, early]]) {
      const m = mergeApprovals([{ node: "avserv-2", result: ok([a!]) }, { node: "avserv-3", result: ok([b!]) }]);
      expect(m.items[0]).toMatchObject({ standing: "declined", decidedAt: "2026-11-11T09:00:01.5Z" });
    }
    const m = mergeApprovals([{ node: "avserv-2", result: ok([item()]) }, { node: "avserv-3", result: ok([early]) }]);
    expect(m.items[0]).toMatchObject({ standing: "approved" });
  });

  it("keeps a name either node has, and lists acceptances only one node holds yet", () => {
    const m = mergeApprovals([
      { node: "avserv-2", result: ok([item({ userDisplayName: null }), item({ acceptanceId: "acc-2", acceptedAt: "2026-11-09T10:00:00Z" })]) },
      { node: "avserv-3", result: ok([item()]) },
    ]);
    expect(m.items.map((i) => [i.acceptanceId, i.userDisplayName])).toEqual([["acc-2", "John Doe"], ["acc-1", "John Doe"]]);
  });

  it("puts waiting people first, oldest first, then approved, then declined", () => {
    const m = mergeApprovals([
      {
        node: "avserv-2",
        result: ok([
          item({ acceptanceId: "d", ...decided("declined", "2026-11-11T09:00:00Z") }),
          item({ acceptanceId: "a", ...decided("approved", "2026-11-11T09:00:00Z") }),
          item({ acceptanceId: "p-new", acceptedAt: "2026-11-11T10:00:00Z" }),
          item({ acceptanceId: "p-old", acceptedAt: "2026-11-01T10:00:00Z" }),
        ]),
      },
    ]);
    expect(m.items.map((i) => i.acceptanceId)).toEqual(["p-old", "p-new", "a", "d"]);
  });

  it("names a node that didn't answer, and carries a cut list", () => {
    const m = mergeApprovals([
      { node: "avserv-2", result: { ok: false, status: 403, code: "path_not_allowed" } },
      { node: "avserv-3", result: { ok: true, items: [item()], truncated: true } },
    ]);
    expect(m.failed).toEqual([{ node: "avserv-2", code: "path_not_allowed" }]);
    expect(m.truncated).toBe(true);
    expect(m.items).toHaveLength(1);
  });
});

describe("the team's words", () => {
  it("says what each standing means, and tells an approval by the switch from a decision", () => {
    expect(standingText({ standing: "pending", decidedAt: null })).toBe("Waiting for your team");
    expect(standingText({ standing: "approved", decidedAt: "2026-11-11T09:00:00Z" })).toBe("Approved");
    expect(standingText({ standing: "approved", decidedAt: null })).toBe("Approved: accepted before your team turned on approvals");
    expect(standingText({ standing: "declined", decidedAt: "2026-11-11T09:00:00Z" })).toBe("Declined");
  });

  it("offers a decision for a waiting person, and a reversal for a decided one", () => {
    expect(decisionsFor("pending").map((d) => d.state)).toEqual(["approved", "declined"]);
    expect(decisionsFor("approved")).toEqual([{ state: "declined", label: "Withdraw approval" }]);
    expect(decisionsFor("declined")).toEqual([{ state: "approved", label: "Approve" }]);
  });

  it("explains AvServ's refusals, and makes no forbidden claim", () => {
    expect(decideErrorText("acceptance_revoked")).toMatch(/withdrawn their acceptance/);
    expect(decideErrorText("sar_capture_unavailable")).toMatch(/can't record decisions right now/);
    expect(decideErrorText("weird")).toContain("(weird)");
    const all = [
      ...["acceptance_revoked", "team_not_confirm_first", "sar_capture_unavailable", "acceptance_unknown", "x"].map(decideErrorText),
      ...(["pending", "approved", "declined"] as const).flatMap((s) => [standingText({ standing: s, decidedAt: null }), ...decisionsFor(s).map((d) => d.label)]),
    ].join(" ").toLowerCase();
    for (const p of FORBIDDEN_PUBLIC_PHRASES) expect(all).not.toContain(p.toLowerCase());
  });
});
