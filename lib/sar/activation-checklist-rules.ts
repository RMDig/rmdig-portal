import { z } from "zod";

import type { ActivationChecklistRecord } from "../db/schema";
import { judgeTestAlert } from "./test-alert-rules";

// The activation checklist's rules for a real team, pure so the approvals
// row (a client component) and the action judge it alike; the facts come from
// lib/sar/activation-checklist.ts. The checklist (plan 33 §6.9 G2; owner,
// 2026-11-11). Approve is refused until every item passes, and every answer
// and check is recorded with the approval (sar_org_status_log.checklist):
//   1. a call-back on the team's publicly listed number;
//   2. a verified portal channel (two or more members, one an admin) and a
//      confirmed on-call email;
//   3. AvServ's test alert, received on both paths from every node
//      (lib/sar/test-alert-rules.ts): sent from this page, proved by the team
//      on its Alerts page;
//   4. published terms carrying counsel's floor clauses, and an area with no
//      unresolved large-area warning.
// The beta (3–5 teams) takes one reviewer, recorded "beta_single"; a second,
// independent reviewer is required before general release.

export const REVIEW_MODE = "beta_single" as const;

export type ActivationFacts = ActivationChecklistRecord["facts"];
export type ActivationAnswers = ActivationChecklistRecord["answers"];
export type ChecklistItem = ActivationChecklistRecord["items"][number];

/** What the approver enters. A checkbox posts "on" when ticked. */
export const activationAnswersSchema = z
  .object({
    callbackNumber: z.string().trim().max(40).optional().default(""),
    callbackSpokeTo: z.string().trim().max(200).optional().default(""),
    termsFloor: z.string().optional(),
    largeAreaResolved: z.string().optional(),
  })
  .transform(
    (v): ActivationAnswers => ({
      callbackNumber: v.callbackNumber,
      callbackSpokeTo: v.callbackSpokeTo,
      termsFloor: v.termsFloor === "on",
      largeAreaResolved: v.largeAreaResolved === "on",
    }),
  );

/** Each item's state, from the facts and the approver's answers. Pure. */
export function judgeChecklist(facts: ActivationFacts, answers: ActivationAnswers): ChecklistItem[] {
  const callback = answers.callbackNumber.length >= 7 && answers.callbackSpokeTo.length > 0;
  const channelProblems = [
    facts.members < 2 ? `${facts.members} member${facts.members === 1 ? "" : "s"} (needs 2 or more)` : null,
    facts.admins < 1 ? "no admin" : null,
    facts.oncallEmailVerified ? null : "no confirmed on-call email",
  ].filter((p): p is string => p !== null);
  const termsProblems = [
    facts.publishedTermsVersion === null ? "no published terms" : null,
    answers.termsFloor ? null : "counsel's floor clauses not confirmed",
    facts.largeArea && !answers.largeAreaResolved ? "large-area warning not resolved" : null,
  ].filter((p): p is string => p !== null);
  return [
    {
      id: "callback",
      status: callback ? "pass" : "fail",
      detail: callback ? `Called ${answers.callbackNumber}, spoke to ${answers.callbackSpokeTo}` : "Enter the number you called and who you spoke to",
    },
    {
      id: "channels",
      status: channelProblems.length ? "fail" : "pass",
      detail: channelProblems.length ? channelProblems.join("; ") : `${facts.members} members, ${facts.admins} admin${facts.admins === 1 ? "" : "s"}, on-call email confirmed`,
    },
    { id: "test_alert", ...judgeTestAlert(facts.testAlert) },
    {
      id: "terms_area",
      status: termsProblems.length ? "fail" : "pass",
      detail: termsProblems.length
        ? termsProblems.join("; ")
        : `Terms version ${facts.publishedTermsVersion}; area ${facts.areaKm2 === null ? "unknown" : `${thousands(Math.round(facts.areaKm2))} km²`}`,
    },
  ];
}

// A count with thousands separators (not toLocaleString, which the date rule
// keeps to lib/format/time).
const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** Approve only when every item passes. */
export function checklistReady(items: ChecklistItem[]): boolean {
  return items.every((i) => i.status === "pass");
}

export function checklistRecord(facts: ActivationFacts, answers: ActivationAnswers, items: ChecklistItem[]): ActivationChecklistRecord {
  return { version: 2, reviewMode: REVIEW_MODE, items, answers, facts };
}

export const CHECKLIST_LABEL: Record<ChecklistItem["id"], string> = {
  callback: "1. Call-back on the team's publicly listed number",
  channels: "2. Portal channel (2+ members, one an admin) and a confirmed on-call email",
  test_alert: "3. Test alert received on both paths from every node",
  terms_area: "4. Terms carry counsel's floor clauses; no unresolved large-area warning",
};
