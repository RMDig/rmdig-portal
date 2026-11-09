"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { canManageOrg } from "@/lib/auth/org-roles";
import { portalActor } from "@/lib/auth/portal-actor";
import { SAR_APPROVER_ROLE } from "@/lib/auth/roles";
import { staffEmails } from "@/lib/auth/staff-recipients";
import { db } from "@/lib/db";
import { sarOrgAreaLog, sarOrgs, users } from "@/lib/db/schema";
import { portalUrl } from "@/lib/email/links";
import { sendSarAreaChangedEmail } from "@/lib/email/send";
import { logger } from "@/lib/logger";
import { reportError, reportProblem } from "@/lib/report-error";
import { assessArea } from "@/lib/sar/area-checks";
import { getRegionAreaKm2, getRegionAsGeoJson, setRegionGeom } from "@/lib/sar/geo";
import { editSarAreaSchema } from "@/lib/sar/schema";
import { syncSarOrg } from "@/lib/sar/sync";

// An approved team's admins change its service area themselves (plan 33 D3,
// step 9.4; CLAUDE.md §0). Staff approve the organization, not its area: the
// guard is AvServ's own checks at bind time, the area log, this staff email
// and suspension. A pending application changes its area through resubmit
// (../edit), which staff review with the rest of it.
//
// The area must pass AvServ's caps on the shape the sync sends, or every node
// would refuse it. The new area, its log row (old and new) land in one
// transaction; the sync and the staff email follow, and a failure of either is
// logged loudly and shown, never rolled back into the saved area.

export type SaveAreaResult =
  | {
      ok: true;
      areaKm2: number;
      /** sent: every node took it; partial: a node didn't (staff can resync). */
      sync: "sent" | "partial";
    }
  | { ok: false; error: string; fieldErrors?: { region?: string[] } };

class StatusChanged extends Error {}

export async function saveAreaAction(orgId: string, _prev: SaveAreaResult | null, formData: FormData): Promise<SaveAreaResult> {
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  const userId = actor.userId;
  if (!(await canManageOrg(userId, orgId))) {
    return { ok: false, error: "Only your team's admins can change its service area." };
  }

  const [org] = await db
    .select({ name: sarOrgs.name, status: sarOrgs.status, editorEmail: users.email })
    .from(sarOrgs)
    .innerJoin(users, eq(users.id, userId))
    .where(eq(sarOrgs.id, orgId))
    .limit(1);
  if (!org) return { ok: false, error: "That team no longer exists." };
  if (org.status !== "approved") {
    return { ok: false, error: "Only an approved team changes its area here. An application under review changes it by resubmitting." };
  }

  const parsed = editSarAreaSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: "Please fix the service area.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const region = parsed.data.region;

  let assessment: Awaited<ReturnType<typeof assessArea>>;
  try {
    assessment = await assessArea(region, orgId);
  } catch (err) {
    logger.error({ event: "sar.area.assess_failed", userId, orgId, err });
    return { ok: false, error: "Couldn't check the area. Try again in a moment." };
  }
  if (!assessment.ok) {
    logger.info({ event: "sar.area.refused", userId, orgId, code: assessment.code });
    return { ok: false, error: assessment.message, fieldErrors: { region: [assessment.message] } };
  }

  let change: { fromKm2: number | null; toKm2: number };
  try {
    change = await db.transaction(async (tx) => {
      // Lock the org so a concurrent suspension or a second edit can't interleave.
      const [row] = await tx.select({ status: sarOrgs.status }).from(sarOrgs).where(eq(sarOrgs.id, orgId)).for("update").limit(1);
      if (row?.status !== "approved") throw new StatusChanged();
      const fromArea = await getRegionAsGeoJson(orgId, tx);
      const fromKm2 = await getRegionAreaKm2(orgId, tx);
      await setRegionGeom(orgId, region, tx);
      const toKm2 = await getRegionAreaKm2(orgId, tx);
      if (toKm2 === null) throw new Error("saveAreaAction: the area didn't save");
      await tx.insert(sarOrgAreaLog).values({ orgId, fromArea, toArea: region, fromAreaKm2: fromKm2, toAreaKm2: toKm2, actorUserId: userId });
      return { fromKm2, toKm2 };
    });
  } catch (err) {
    if (err instanceof StatusChanged) {
      return { ok: false, error: "Your team's status changed while you were editing. Reload to see it." };
    }
    logger.error({ event: "sar.area.save_failed", userId, orgId, err });
    return { ok: false, error: "Couldn't save the area. Try again in a moment." };
  }
  logger.info({ event: "sar.area.changed", userId, orgId, fromKm2: change.fromKm2, toKm2: change.toKm2 });

  const sync = await syncArea(orgId);
  await notifyStaff(orgId, { orgName: org.name, editorEmail: org.editorEmail, fromAreaKm2: change.fromKm2, toAreaKm2: change.toKm2 });
  revalidatePath(`/sar/${orgId}/area`);
  return { ok: true, areaKm2: change.toKm2, sync };
}

/** The saved area goes to every node now. A node that fails is recorded per
 *  node by syncSarOrg and shown to staff, who can resync. */
async function syncArea(orgId: string): Promise<"sent" | "partial"> {
  try {
    const outcomes = await syncSarOrg(orgId);
    if (outcomes.length > 0 && outcomes.every((o) => o.outcome === "ok")) return "sent";
    reportProblem("sar.area.sync_incomplete", "A team's new service area didn't reach every AvServ node", {
      orgId,
      outcomes: outcomes.map((o) => `${o.node}:${o.outcome}`).join(","),
    });
    return "partial";
  } catch (err) {
    reportError("sar.area.sync_failed", err, { orgId });
    return "partial";
  }
}

async function notifyStaff(
  orgId: string,
  params: { orgName: string; editorEmail: string; fromAreaKm2: number | null; toAreaKm2: number },
): Promise<void> {
  let staff: string[];
  try {
    staff = await staffEmails([SAR_APPROVER_ROLE]);
  } catch (err) {
    reportError("sar.area.staff_lookup_failed", err, { orgId });
    return;
  }
  if (staff.length === 0) reportProblem("sar.area.no_staff_to_notify", "No rmdig staff to tell about a team's area change", { orgId });
  const orgUrl = portalUrl(`/admin/sar-approvals#org-${orgId}`);
  for (const email of staff) {
    try {
      await sendSarAreaChangedEmail(email, { ...params, orgUrl });
    } catch (err) {
      logger.error({ event: "sar.area.staff_email_failed", orgId, to: email, err });
    }
  }
}
