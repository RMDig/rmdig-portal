"use server";

import { revalidatePath } from "next/cache";

import { canManageOrg } from "@/lib/auth/org-roles";
import { portalActor } from "@/lib/auth/portal-actor";
import { changeLeaving, type LeavingChange } from "@/lib/sar/leaving";

// A team's admin gives its leaving notice, or undoes it (plan 33 §6.9; the
// change itself is lib/sar/leaving.ts). Admins only, behind two-factor.

export type LeaveResult = { ok: true; synced: boolean } | { ok: false; error: string };

async function run(orgId: string, change: LeavingChange, formData: FormData): Promise<LeaveResult> {
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  if (!/^[0-9a-f-]{36}$/i.test(orgId) || !(await canManageOrg(actor.userId, orgId))) {
    return { ok: false, error: "Only your team's admins can change whether it's leaving." };
  }
  // Giving notice takes a deliberate tick, like any change that stops offers.
  if (change === "give_notice" && formData.get("confirm") !== "on") {
    return { ok: false, error: "Tick the box to confirm you've read what leaving does." };
  }
  const r = await changeLeaving(orgId, actor.userId, change);
  if (r.ok) {
    revalidatePath(`/sar/${orgId}/leave`);
    revalidatePath(`/sar/${orgId}`, "layout");
  }
  return r;
}

export async function giveLeavingNoticeAction(orgId: string, _prev: LeaveResult | null, formData: FormData): Promise<LeaveResult> {
  return run(orgId, "give_notice", formData);
}

export async function undoLeavingAction(orgId: string, _prev: LeaveResult | null, formData: FormData): Promise<LeaveResult> {
  return run(orgId, "undo", formData);
}
