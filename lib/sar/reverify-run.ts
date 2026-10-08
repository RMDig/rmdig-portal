import { and, eq, inArray, isNotNull, lte } from "drizzle-orm";

import { db } from "../db";
import { orgMemberships, sarOrgs, sarReverifyReminders, userPlatformRoles, users } from "../db/schema";
import { sendPatrolReverifyStaffEmail, sendPatrolReverifyTeamEmail } from "../email/send";
import { logger } from "../logger";
import { reportProblem } from "../report-error";
import { LOOKAHEAD_DAYS, patrolAdminsNotified, reminderStage } from "./reverify";
import { portalUrl } from "../email/links";

// The daily patrol re-verification run (app/api/cron/patrol-reverify). Each
// stage is claimed in sar_reverify_reminders before sending, so overlapping
// or repeated runs send it once. If every email for a stage fails, the claim
// is released and tomorrow's run tries again; a partial failure keeps it
// (someone was told) and is logged loudly.

export interface ReverifyRunSummary {
  due: number;
  sent: number;
  failed: number;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { timeZone: "America/Denver", month: "long", day: "numeric", year: "numeric" });
}

export async function runReverifyReminders(now: Date): Promise<ReverifyRunSummary> {
  const horizon = new Date(now.getTime() + LOOKAHEAD_DAYS * 86_400_000);
  const patrols = await db
    .select({ id: sarOrgs.id, name: sarOrgs.name, reverifyBy: sarOrgs.reverifyBy, contactPhone: sarOrgs.contactPhone })
    .from(sarOrgs)
    .where(
      and(
        eq(sarOrgs.orgType, "ski_patrol"),
        inArray(sarOrgs.status, ["approved", "leaving"]),
        isNotNull(sarOrgs.reverifyBy),
        lte(sarOrgs.reverifyBy, horizon),
      ),
    );
  const summary: ReverifyRunSummary = { due: 0, sent: 0, failed: 0 };
  if (patrols.length === 0) return summary;

  const staff = await db
    .select({ email: users.email })
    .from(userPlatformRoles)
    .innerJoin(users, eq(users.id, userPlatformRoles.userId))
    // Re-verifying a patrol is a SAR approver's call (lib/auth/roles.ts).
    .where(eq(userPlatformRoles.role, "rmdig_sar_approver"));
  if (staff.length === 0) reportProblem("sar.reverify.no_staff_recipients", "Patrol re-verification reminders have no SAR approver to go to");

  for (const p of patrols) {
    const reverifyBy = p.reverifyBy!;
    const stage = reminderStage(reverifyBy, now);
    if (!stage) continue;
    const claimed = await db
      .insert(sarReverifyReminders)
      .values({ orgId: p.id, reverifyBy, stage })
      .onConflictDoNothing()
      .returning({ orgId: sarReverifyReminders.orgId });
    if (claimed.length === 0) continue;
    summary.due++;

    const admins = patrolAdminsNotified(stage)
      ? await db
          .select({ email: users.email })
          .from(orgMemberships)
          .innerJoin(users, eq(users.id, orgMemberships.userId))
          .where(and(eq(orgMemberships.orgId, p.id), eq(orgMemberships.role, "admin")))
      : [];
    const deadline = formatDate(reverifyBy);
    const sends = [
      ...staff.map((s) => () =>
        sendPatrolReverifyStaffEmail(s.email, {
          orgName: p.name,
          stage,
          reverifyBy: deadline,
          contactPhone: p.contactPhone,
          reviewUrl: portalUrl(`/admin/sar-approvals`),
        }),
      ),
      ...admins.map((a) => () =>
        sendPatrolReverifyTeamEmail(a.email, { orgName: p.name, stage, reverifyBy: deadline, supportUrl: portalUrl(`/support`) }),
      ),
    ];
    let ok = 0;
    for (const send of sends) {
      try {
        await send();
        ok++;
      } catch (err) {
        summary.failed++;
        // lib/email/send has already reported it to Sentry.
        logger.error({ event: "sar.reverify.email_failed", orgId: p.id, stage, err });
      }
    }
    summary.sent += ok;
    if (ok === 0) {
      // Nobody was told: release the claim so the next run retries.
      await db
        .delete(sarReverifyReminders)
        .where(
          and(
            eq(sarReverifyReminders.orgId, p.id),
            eq(sarReverifyReminders.reverifyBy, reverifyBy),
            eq(sarReverifyReminders.stage, stage),
          ),
        );
      logger.error({ event: "sar.reverify.stage_unsent", orgId: p.id, stage });
    } else {
      logger.info({ event: "sar.reverify.stage_sent", orgId: p.id, stage, emails: ok });
    }
  }
  return summary;
}
