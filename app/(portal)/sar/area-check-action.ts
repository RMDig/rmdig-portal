"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { canManageOrg } from "@/lib/auth/org-roles";
import { portalActor } from "@/lib/auth/portal-actor";
import { db } from "@/lib/db";
import { sarOrgs } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { assessArea, LARGE_AREA_KM2 } from "@/lib/sar/area-checks";
import { type RegionPolygon, RegionPolygonSchema } from "@/lib/sar/geo";

// The check the area editor runs on each new drawing (plan 33 §6.3 steps 1–3,
// steps 9.5–9.6), for a new application (no org yet), a pending one being
// resubmitted, or an approved team's edit. Read-only; it never blocks a save,
// and the save runs the same checks again.
//
// Other teams are named, and the clip offered, only to an approved team's
// admins: an applicant isn't verified yet, and the clip would trace other
// teams' borders. Staff see every overlap when they review.

export type CheckAreaResult =
  | {
      ok: true;
      areaKm2: number;
      /** Set when above Colorado's largest county (plan 33 O8): a warning, never a block. */
      large: { thresholdKm2: number } | null;
      /** Other live teams this area overlaps, by name (§6.3 step 1). Empty unless approved. */
      overlaps: Array<{ name: string; overlapKm2: number }>;
      /** The area without the overlaps, when it's still one shape. */
      clip: { ok: true; area: RegionPolygon; areaKm2: number } | { ok: false; message: string } | null;
    }
  | { ok: false; error: string };

const OrgIdSchema = z.string().uuid().nullable();

export async function checkAreaAction(orgId: string | null, drawn: unknown): Promise<CheckAreaResult> {
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  const org = OrgIdSchema.safeParse(orgId);
  if (!org.success) return { ok: false, error: "That team couldn't be found." };

  let showTeams = false;
  if (org.data) {
    if (!(await canManageOrg(actor.userId, org.data))) {
      return { ok: false, error: "Only your team's admins can change its service area." };
    }
    const [row] = await db.select({ status: sarOrgs.status }).from(sarOrgs).where(eq(sarOrgs.id, org.data)).limit(1);
    if (row?.status === "approved") showTeams = true;
    else if (row?.status !== "pending") return { ok: false, error: "This team's service area can't be changed now." };
  }

  const parsed = RegionPolygonSchema.safeParse(drawn);
  if (!parsed.success) return { ok: false, error: "That service area couldn't be read. Clear it and enter it again." };

  let a: Awaited<ReturnType<typeof assessArea>>;
  try {
    a = await assessArea(parsed.data, org.data);
  } catch (err) {
    logger.error({ event: "sar.area.check_failed", userId: actor.userId, orgId: org.data, err });
    return { ok: false, error: "Couldn't check the area. Try again in a moment." };
  }
  if (!a.ok) return { ok: false, error: a.message };

  const clip = a.clip
    ? a.clip.ok
      ? a.clip.caps.ok
        ? { ok: true as const, area: a.clip.area, areaKm2: a.clip.areaKm2 }
        : { ok: false as const, message: a.clip.caps.message }
      : { ok: false as const, message: a.clip.message }
    : null;
  return {
    ok: true,
    areaKm2: a.areaKm2,
    large: a.areaKm2 > LARGE_AREA_KM2 ? { thresholdKm2: LARGE_AREA_KM2 } : null,
    overlaps: showTeams ? a.overlaps.map((o) => ({ name: o.name, overlapKm2: o.overlapKm2 })) : [],
    clip: showTeams ? clip : null,
  };
}
