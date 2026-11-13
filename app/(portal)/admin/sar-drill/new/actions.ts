"use server";

import { portalActor } from "@/lib/auth/portal-actor";
import { hasPlatformRole } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { sarOrgs, sarOrgStatusLog } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { requireVerifiedOrgPhone } from "@/lib/phone/org-phone";
import { assessArea } from "@/lib/sar/area-checks";
import { checkDrillArea, DRILL_REGISTERED_NOTE } from "@/lib/sar/drill";
import { setRegionGeom } from "@/lib/sar/geo";
import { registerDrillOrgSchema } from "@/lib/sar/schema";

// Register a drill team (plan 37 §4.3), for rmdig_admin only. It never goes
// through /sar/new, so the public form can't set the drill flag. Nothing
// outside RMDig is verified, so there is no proof document and no review: the
// team starts `pending`, and the operator activates it with its own logged
// decision (P5), never Approve. The drill flag is permanent (migration 0036).
//
// Unlike an application, nobody is emailed: staff registered it, and a drill
// team never reaches the new-application email (plan 37 rule 5). The
// registering admin isn't made a member: staff are never drill logins.

export type RegisterDrillResult =
  | { ok: true; orgId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

export async function registerDrillOrgAction(_prev: RegisterDrillResult | null, formData: FormData): Promise<RegisterDrillResult> {
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  const userId = actor.userId;
  if (!(await hasPlatformRole(userId, "rmdig_admin"))) {
    logger.warn({ event: "sar.drill.register_forbidden", userId });
    return { ok: false, error: "Only rmdig admins can register a drill team." };
  }

  const parsed = registerDrillOrgSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  // The ordinary checks first (what AvServ accepts), then the drill limits:
  // small, and never over a real team's area (plan 37 §4.4).
  let assessment: Awaited<ReturnType<typeof assessArea>>;
  try {
    assessment = await assessArea(data.region, null);
  } catch (err) {
    logger.error({ event: "sar.drill.area_check_failed", userId, err });
    return { ok: false, error: "Couldn't check the service area. Try again in a moment." };
  }
  if (!assessment.ok) {
    return { ok: false, error: assessment.message, fieldErrors: { region: [assessment.message] } };
  }
  const drillArea = checkDrillArea(assessment);
  if (!drillArea.ok) {
    logger.info({ event: "sar.drill.area_refused", userId, code: drillArea.code });
    return { ok: false, error: drillArea.message, fieldErrors: { region: [drillArea.message] } };
  }

  // The drill phone is verified like any team's: it's the number AvServ calls.
  // Every drill team may share it: the one-number rule skips drill teams
  // (sar_orgs_contact_phone_live_unique, migration 0046).
  const phoneGate = await requireVerifiedOrgPhone(data.contactPhone, data.phoneCode, { token: data.phoneProof, userId });
  if (!phoneGate.ok) return { ok: false, error: phoneGate.error, fieldErrors: phoneGate.fieldErrors };

  let orgId: string;
  try {
    orgId = await db.transaction(async (tx) => {
      const [org] = await tx
        .insert(sarOrgs)
        .values({
          orgType: "sar_team",
          name: data.name,
          regionName: data.regionName,
          contactName: data.contactName,
          contactEmail: data.contactEmail,
          contactPhone: phoneGate.phone,
          operatingStatus: "other",
          operatingStatusOther: "RMDig drill team (plan 37)",
          proofDocUrl: null,
          isDrill: true,
          createdByUserId: userId,
        })
        .returning({ id: sarOrgs.id });
      if (!org) throw new Error("sar_orgs insert returned no row");
      await setRegionGeom(org.id, data.region, tx);
      await tx.insert(sarOrgStatusLog).values({
        orgId: org.id,
        action: "drill_registered",
        fromStatus: null,
        toStatus: "pending",
        note: DRILL_REGISTERED_NOTE,
        actorUserId: userId,
      });
      return org.id;
    });
  } catch (err) {
    logger.error({ event: "sar.drill.register_failed", userId, err });
    return { ok: false, error: "Couldn't register the drill team. Try again in a moment." };
  }

  logger.info({ event: "sar.drill.registered", userId, orgId });
  return { ok: true, orgId };
}
