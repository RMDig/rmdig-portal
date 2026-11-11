import { z } from "zod";

import type { ActivationChecklistRecord, TestAlertNodeFact } from "../db/schema";

// A team's test alert, judged for the activation checklist's item 3 (plan 33
// §6.9 G2; AvServ sar_test_alert.md). Pure: the approvals row (a client
// component) and the approve action judge it alike; the facts come from
// lib/sar/test-alert.ts.
//
// It passes when the latest test, sent within TEST_FRESH_DAYS, reached the
// team on both paths from every configured node: AvServ delivered the portal
// message, it arrived at the intake and a member marked it received; AvServ's
// relay accepted the email, and a member entered the code it carried. A node
// added since the test (avserv-1) is a node the test didn't prove.

export type TestAlertFact = ActivationChecklistRecord["facts"]["testAlert"];

/** A proof this old no longer says the team is reachable today. */
export const TEST_FRESH_DAYS = 14;
/** Guesses at one node's code before staff must send a new test. */
export const MAX_CODE_ATTEMPTS = 5;

export const testCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Enter the six digits from the test email.");

/** What's still missing on one node, in the order the team works through it. */
export function nodeProblems(n: TestAlertNodeFact | undefined, node: string): string[] {
  if (!n) return [`${node}: not in the latest test (send a new one)`];
  if (n.error !== null || n.testId === null) return [`${node}: the test failed (${n.error ?? "no answer"})`];
  const out: string[] = [];
  if (n.portal !== "delivered") out.push(`${node} portal message: ${n.portal ?? "no result"}`);
  else if (!n.portalArrived) out.push(`${node} portal message: hasn't arrived`);
  else if (!n.portalReceived) out.push(`${node} portal message: not yet marked received`);
  if (n.email !== "accepted") out.push(`${node} email: ${n.email ?? "no result"}`);
  else if (!n.emailConfirmed) out.push(`${node} email: code not yet entered`);
  return out;
}

export function judgeTestAlert(t: TestAlertFact): { status: "pass" | "fail"; detail: string } {
  if (t.configuredNodes.length === 0) return { status: "fail", detail: "No AvServ nodes are configured (AVSERV_NODE_URLS)" };
  if (t.requestedAt === null) return { status: "fail", detail: "No test sent yet: use Send test alert on this row" };
  if (t.expired) return { status: "fail", detail: `The latest test is over ${TEST_FRESH_DAYS} days old: send a new one` };
  const problems = t.configuredNodes.flatMap((node) => nodeProblems(t.nodes.find((n) => n.node === node), node));
  return problems.length
    ? { status: "fail", detail: problems.join("; ") }
    : { status: "pass", detail: `Received on both paths from ${t.configuredNodes.join(", ")}` };
}

/** Human words for AvServ's channel results and the portal's failure codes. */
export const CHANNEL_RESULT_LABEL: Record<string, string> = {
  delivered: "delivered to the portal",
  accepted: "accepted by the email relay",
  failed: "failed",
  not_configured: "not configured on this node",
  missing: "not reported by AvServ",
};
