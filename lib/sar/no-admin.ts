import { sql } from "drizzle-orm";

import { SAR_APPROVER_ROLE } from "../auth/roles";
import { staffEmails } from "../auth/staff-recipients";
import { db } from "../db";
import { portalUrl } from "../email/links";
import { sendSarNoAdminStaffEmail } from "../email/send";
import { logger } from "../logger";
import { reportProblem } from "../report-error";

// A live SAR team with no admin (plan 33 §6.4, step 9.13). The members page
// refuses to remove or demote the last admin (lib/sar/membership.ts), but an
// account deletion (runbook "Data-deletion requests") can still leave none,
// and then nobody can manage the team's members, terms or area. The team
// pages show a banner (app/(portal)/sar/[orgId]/layout.tsx), and SAR
// approvers get a daily email while any team is in this state. What staff do
// about it is theirs to decide (plan 33 §6.4 [ESCALATE]).

export type TeamWithoutAdmin = { id: string; name: string; status: string };

const LIVE = sql`('pending', 'approved', 'suspended', 'leaving')`;

export async function teamsWithoutAdmin(): Promise<TeamWithoutAdmin[]> {
  return (await db.execute(sql`
    SELECT o.id, o.name, o.status::text AS status
    FROM sar_orgs o
    WHERE o.status::text IN ${LIVE}
      AND NOT EXISTS (SELECT 1 FROM org_memberships m WHERE m.org_id = o.id AND m.role = 'admin')
    ORDER BY o.name
  `)) as unknown as TeamWithoutAdmin[];
}

/** Whether one team has an admin, for its pages' banner. */
export async function teamHasAdmin(orgId: string): Promise<boolean> {
  const rows = (await db.execute(sql`
    SELECT 1 FROM org_memberships WHERE org_id = ${orgId} AND role = 'admin' LIMIT 1
  `)) as unknown as unknown[];
  return rows.length > 0;
}

export interface NoAdminRunSummary {
  teams: number;
  sent: number;
  failed: number;
}

/** The daily run (app/api/cron/sar-no-admin): one email per approver listing
 *  every such team. Repeats each day while it lasts, by design. */
export async function runNoAdminCheck(): Promise<NoAdminRunSummary> {
  const teams = await teamsWithoutAdmin();
  if (teams.length === 0) return { teams: 0, sent: 0, failed: 0 };

  reportProblem("sar.no_admin", "A live SAR team has no admin", { teams: teams.map((t) => t.id).join(",") });
  const staff = await staffEmails([SAR_APPROVER_ROLE]);
  if (staff.length === 0) {
    reportProblem("sar.no_admin.no_staff_to_notify", "No rmdig staff to tell about a SAR team with no admin", { teams: teams.length });
    return { teams: teams.length, sent: 0, failed: 0 };
  }
  const params = { teams: teams.map((t) => ({ name: t.name, status: t.status })), queueUrl: portalUrl("/admin/sar-approvals") };
  let sent = 0;
  let failed = 0;
  for (const email of staff) {
    try {
      await sendSarNoAdminStaffEmail(email, params);
      sent++;
    } catch (err) {
      failed++;
      logger.error({ event: "sar.no_admin.staff_email_failed", to: email, err });
    }
  }
  return { teams: teams.length, sent, failed };
}
