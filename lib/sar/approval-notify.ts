import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";

import { getApprovalSummary } from "../avserv/sar-approvals";
import { avservNodes } from "../avserv/sar-teams";
import { db } from "../db";
import { orgMemberships, sarOrgs, users } from "../db/schema";
import { portalUrl } from "../email/links";
import { sendSarApprovalWaitingEmail } from "../email/send";
import { logger } from "../logger";
import { reportProblem } from "../report-error";
import { approvalNotifyPlan } from "./approval-notify-rules";
import { APPROVALS_STATUSES } from "./approvals-rules";

// Every 5 minutes (app/api/cron/sar-approval-notify): email a confirm-first
// team's admins when someone new waits for approval (plan 33 9.8; owner
// 2026-11-12). It reads AvServ's count-only summary on every node (sar_terms.md
// §6a), never the list, which names people and is logged as a disclosure to
// the admin reading it. When to email is lib/sar/approval-notify-rules.ts.
//
// Recorded only once an admin was told, so a total failure is tried again on
// the next run. A node that can't be read is logged; the nodes that answered
// still decide.

export interface ApprovalNotifyRunSummary {
  teams: number;
  notified: number;
  sent: number;
  failed: number;
  unread: number;
}

export async function runApprovalNotify(): Promise<ApprovalNotifyRunSummary> {
  const summary: ApprovalNotifyRunSummary = { teams: 0, notified: 0, sent: 0, failed: 0, unread: 0 };
  const teams = await db
    .select({ id: sarOrgs.id, name: sarOrgs.name, isDrill: sarOrgs.isDrill, through: sarOrgs.approvalNotifiedThrough })
    .from(sarOrgs)
    .where(and(eq(sarOrgs.acceptanceMode, "confirm_first"), inArray(sarOrgs.status, [...APPROVALS_STATUSES])));
  summary.teams = teams.length;
  if (teams.length === 0) return summary;

  const nodes = avservNodes();
  if (nodes.length === 0) {
    reportProblem("sar.approval_notify.no_avserv_nodes", "No AvAI servers are configured, so no team can be told someone is waiting", { teams: teams.length });
    return summary;
  }

  for (const team of teams) {
    const reads = await Promise.all(nodes.map(async (n) => ({ node: n.name, result: await getApprovalSummary(n, team.id) })));
    // What each node said, without a person in it: the record of why an email
    // went or didn't.
    for (const r of reads) {
      if (r.result.ok) {
        logger.info({ event: "sar.approval_notify.read", orgId: team.id, node: r.node, pending: r.result.pending, newest: r.result.newestPendingAcceptedAt });
      }
    }
    const plan = approvalNotifyPlan(reads, team.through);
    for (const f of plan.failed) logger.error({ event: "sar.approval_notify.node_failed", orgId: team.id, node: f.node, code: f.code });
    if (plan.kind === "unread") {
      summary.unread++;
      reportProblem("sar.approval_notify.unread", "No AvAI server answered a confirm-first team's approval summary", { orgId: team.id });
      continue;
    }
    if (plan.kind === "none") continue;

    const admins = await db
      .select({ email: users.email })
      .from(orgMemberships)
      .innerJoin(users, eq(users.id, orgMemberships.userId))
      .where(and(eq(orgMemberships.orgId, team.id), eq(orgMemberships.role, "admin")));
    if (admins.length === 0) {
      // The daily no-admin email already tells staff; this says what it cost.
      reportProblem("sar.approval_notify.no_admin", "Someone waits for a SAR team's approval, and the team has no admin to tell", { orgId: team.id });
      continue;
    }
    let sent = 0;
    for (const a of admins) {
      try {
        await sendSarApprovalWaitingEmail(a.email, { teamName: team.name, approvalsUrl: portalUrl(`/sar/${team.id}/approvals`), drill: team.isDrill });
        sent++;
      } catch (err) {
        summary.failed++;
        logger.error({ event: "sar.approval_notify.email_failed", orgId: team.id, to: a.email, err });
      }
    }
    summary.sent += sent;
    if (sent === 0) {
      reportProblem("sar.approval_notify.email_undelivered", "No admin of a SAR team could be told someone is waiting", { orgId: team.id });
      continue;
    }
    // Only forward: a run that read an older time never moves it back.
    await db
      .update(sarOrgs)
      .set({ approvalNotifiedThrough: plan.through })
      .where(and(eq(sarOrgs.id, team.id), or(isNull(sarOrgs.approvalNotifiedThrough), lt(sarOrgs.approvalNotifiedThrough, plan.through))));
    summary.notified++;
  }
  return summary;
}
