"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { canManageOrg } from "@/lib/auth/org-roles";
import { portalActor } from "@/lib/auth/portal-actor";
import { db } from "@/lib/db";
import { sarOrgs } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { decideAcceptance } from "@/lib/sar/approvals";
import { decideErrorText, hasApprovals } from "@/lib/sar/approvals-rules";

// A confirm-first team's admins approve or decline a user's acceptance of the
// team's terms (plan 33 D4, 9.8; AvServ sar_terms.md §6): once per terms
// version, never per check-out. A decline or a withdrawn approval never
// unbinds a check-out; it applies from the next one.

export type DecideResult = { ok: true; state: "approved" | "declined" } | { ok: false; error: string };

const input = z.object({
  acceptanceId: z.string().min(1).max(100),
  state: z.enum(["approved", "declined"]),
});

export async function decideAction(orgId: string, _prev: DecideResult | null, formData: FormData): Promise<DecideResult> {
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  if (!(await canManageOrg(actor.userId, orgId))) return { ok: false, error: "Only your team's admins can approve or decline people." };
  const parsed = input.safeParse({ acceptanceId: formData.get("acceptanceId"), state: formData.get("state") });
  if (!parsed.success) return { ok: false, error: "Unknown request." };

  const [org] = await db.select({ status: sarOrgs.status, mode: sarOrgs.acceptanceMode }).from(sarOrgs).where(eq(sarOrgs.id, orgId)).limit(1);
  if (!org) return { ok: false, error: "That team no longer exists." };
  if (org.mode !== "confirm_first") return { ok: false, error: "Your team doesn't approve people first, so there's nothing to decide." };
  if (!hasApprovals(org.status)) return { ok: false, error: "Your team isn't on AvAI's servers, so there's nothing to decide." };

  const r = await decideAcceptance(orgId, parsed.data.acceptanceId, parsed.data.state, actor.userId);
  revalidatePath(`/sar/${orgId}/approvals`);
  if (!r.ok) {
    logger.warn({ event: "sar.approvals.decide_refused", orgId, userId: actor.userId, code: r.code });
    return { ok: false, error: decideErrorText(r.code) };
  }
  return { ok: true, state: parsed.data.state };
}
