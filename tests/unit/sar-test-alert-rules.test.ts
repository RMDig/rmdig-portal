import { describe, expect, it } from "vitest";

import type { TestAlertNodeFact } from "@/lib/db/schema";
import { judgeTestAlert, nodeProblems, testCodeSchema, type TestAlertFact } from "@/lib/sar/test-alert-rules";

// The test alert's judgement for checklist item 3 (plan 33 §6.9 G2; AvServ
// sar_test_alert.md): both paths, every configured node, fresh.

const proved = (node: string): TestAlertNodeFact => ({
  node,
  testId: `t-${node}`,
  error: null,
  portal: "delivered",
  email: "accepted",
  portalArrived: true,
  portalReceived: true,
  emailConfirmed: true,
});
const fact = (o: Partial<TestAlertFact> = {}): TestAlertFact => ({
  requestedAt: "2026-11-11T16:00:00.000Z",
  expired: false,
  configuredNodes: ["avserv-2", "avserv-3"],
  nodes: [proved("avserv-2"), proved("avserv-3")],
  ...o,
});

describe("judgeTestAlert", () => {
  it("passes when every configured node's test reached the team on both paths", () => {
    expect(judgeTestAlert(fact())).toEqual({ status: "pass", detail: "Received on both paths from avserv-2, avserv-3" });
  });

  it("fails with no nodes configured, no test sent, or a stale test", () => {
    expect(judgeTestAlert(fact({ configuredNodes: [] })).detail).toContain("No AvServ nodes are configured");
    expect(judgeTestAlert(fact({ requestedAt: null, nodes: [] })).detail).toBe("No test sent yet: use Send test alert on this row");
    expect(judgeTestAlert(fact({ expired: true }))).toEqual({ status: "fail", detail: "The latest test is over 14 days old: send a new one" });
  });

  it("fails a node added since the test (avserv-1 joining)", () => {
    const r = judgeTestAlert(fact({ configuredNodes: ["avserv-1", "avserv-2", "avserv-3"] }));
    expect(r).toEqual({ status: "fail", detail: "avserv-1: not in the latest test (send a new one)" });
  });

  it("names each node's missing step", () => {
    const r = judgeTestAlert(
      fact({ nodes: [{ ...proved("avserv-2"), portalArrived: false, emailConfirmed: false }, { ...proved("avserv-3"), testId: null, error: "unreachable" }] }),
    );
    expect(r.status).toBe("fail");
    expect(r.detail).toBe("avserv-2 portal message: hasn't arrived; avserv-2 email: code not yet entered; avserv-3: the test failed (unreachable)");
  });
});

describe("nodeProblems", () => {
  it("reports a channel AvServ didn't send on as its result, before what the team must do", () => {
    expect(nodeProblems({ ...proved("n"), portal: "failed", email: "not_configured", portalReceived: false, emailConfirmed: false }, "n")).toEqual([
      "n portal message: failed",
      "n email: not_configured",
    ]);
    expect(nodeProblems({ ...proved("n"), portalReceived: false }, "n")).toEqual(["n portal message: not yet marked received"]);
  });
});

describe("testCodeSchema", () => {
  it("takes six digits, trimmed, and refuses anything else", () => {
    expect(testCodeSchema.parse(" 482915 ")).toBe("482915");
    for (const bad of ["", "48291", "4829150", "48291a"]) expect(testCodeSchema.safeParse(bad).success).toBe(false);
  });
});
