import { and, eq, sql } from "drizzle-orm";

import { SAR_APPROVER_ROLE } from "../auth/roles";
import { staffEmails } from "../auth/staff-recipients";
import { db } from "../db";
import { sarOrgs, sarOrgStatusLog, users } from "../db/schema";
import { portalUrl } from "../email/links";
import { sendSarLeavingStaffEmail } from "../email/send";
import { logger } from "../logger";
import { reportError, reportProblem } from "../report-error";
import { syncSarOrg } from "./sync";

// A team gives its own leaving notice, or undoes it (plan 33 §6.9, owner
// 2026-11-11). Leaving is a sink on AvServ (sar_team_sync.md §4): no new
// offers or binds, and check-outs already bound keep the team, and its
// alerts, until each ends. Undo sends `approved` again. Possible until staff
// withdraw the team; staff can do both from the approvals queue too.
//
// Like the staff decisions: a guarded status change and a status-log row in
// one transaction, then the sync (the row is the truth; a node that missed
// it is resynced), then staff are told. Neither of the last two undoes it.

export type LeavingChange = "give_notice" | "undo";

const CHANGE = {
  give_notice: { from: "approved", to: "leaving", action: "leaving" },
  undo: { from: "leaving", to: "approved", action: "leaving_undone" },
} as const;

export type LeavingResult = { ok: true; synced: boolean } | { ok: false; error: string };

export async function changeLeaving(orgId: string, userId: string, change: LeavingChange): Promise<LeavingResult> {
  const c = CHANGE[change];
  const [org] = await db
    .select({ name: sarOrgs.name, status: sarOrgs.status, isDrill: sarOrgs.isDrill, actorEmail: users.email })
    .from(sarOrgs)
    .innerJoin(users, eq(users.id, userId))
    .where(eq(sarOrgs.id, orgId))
    .limit(1);
  if (!org) return { ok: false, error: "That team no longer exists." };
  if (org.status !== c.from) {
    return {
      ok: false,
      error: change === "give_notice" ? "Only an active team can give its leaving notice." : "Your team isn't leaving, so there's nothing to undo.",
    };
  }

  const now = new Date();
  const updated = await db.transaction(async (tx) => {
    const rows = await tx
      .update(sarOrgs)
      .set({ status: c.to, leavingNoticeAt: change === "give_notice" ? now : null, reviewRevision: sql`${sarOrgs.reviewRevision} + 1` })
      .where(and(eq(sarOrgs.id, orgId), eq(sarOrgs.status, c.from)))
      .returning({ id: sarOrgs.id });
    if (rows.length === 0) return false;
    await tx.insert(sarOrgStatusLog).values({ orgId, action: c.action, fromStatus: c.from, toStatus: c.to, note: "By the team", actorUserId: userId });
    return true;
  });
  // Someone else (staff, or another admin) changed it first.
  if (!updated) return { ok: false, error: "Your team's status changed just now. Reload the page." };
  logger.info({ event: "sar.leaving.changed", orgId, userId, change });

  let synced = false;
  try {
    const outcomes = await syncSarOrg(orgId);
    synced = outcomes.length > 0 && outcomes.every((o) => o.outcome === "ok");
    if (!synced) {
      reportProblem("sar.leaving.sync_incomplete", "A team's leaving change didn't reach every AvServ node", {
        orgId,
        change,
        outcomes: outcomes.map((o) => `${o.node}:${o.outcome}`).join(","),
      });
    }
  } catch (err) {
    reportError("sar.leaving.sync_failed", err, { orgId, change });
  }
  await notifyStaff(orgId, { orgName: org.name, actorEmail: org.actorEmail, change, drill: org.isDrill });
  return { ok: true, synced };
}

async function notifyStaff(orgId: string, p: { orgName: string; actorEmail: string; change: LeavingChange; drill: boolean }) {
  let staff: string[];
  try {
    staff = await staffEmails([SAR_APPROVER_ROLE]);
  } catch (err) {
    reportError("sar.leaving.staff_lookup_failed", err, { orgId });
    return;
  }
  if (staff.length === 0) reportProblem("sar.leaving.no_staff_to_notify", "No rmdig staff to tell about a team's leaving change", { orgId });
  // A drill team isn't in the approvals queue (plan 37 §4.7).
  const orgUrl = portalUrl(p.drill ? "/admin/sar-drill" : `/admin/sar-approvals#org-${orgId}`);
  for (const to of staff) {
    try {
      await sendSarLeavingStaffEmail(to, { orgName: p.orgName, actorEmail: p.actorEmail, change: p.change, orgUrl, drill: p.drill });
    } catch (err) {
      logger.error({ event: "sar.leaving.staff_email_failed", orgId, to, err });
    }
  }
}
