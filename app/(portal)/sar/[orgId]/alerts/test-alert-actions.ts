"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { portalActor } from "@/lib/auth/portal-actor";
import { getOrgRole } from "@/lib/auth/org-roles";
import { confirmTestCode, markTestReceived } from "@/lib/sar/test-alert";
import { testCodeSchema } from "@/lib/sar/test-alert-rules";

// The team proves AvServ's test alert reached it (plan 33 §6.9 G2 item 3;
// AvServ sar_test_alert.md): a member marks each node's portal message
// received, and enters the code each node's email carried. The same members
// who handle alerts do it: admins and dispatchers.

export type TestProofResult = { ok: true } | { ok: false; error: string };

const rowId = z.string().uuid();

async function teamActor(orgId: string): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const actor = await portalActor();
  if (!actor.ok) return actor;
  const role = await getOrgRole(actor.userId, orgId);
  if (role !== "admin" && role !== "dispatcher") return { ok: false, error: "Only your team's admins and dispatchers can confirm a test." };
  return actor;
}

export async function markTestReceivedAction(orgId: string, _prev: TestProofResult | null, formData: FormData): Promise<TestProofResult> {
  const actor = await teamActor(orgId);
  if (!actor.ok) return actor;
  const id = rowId.safeParse(formData.get("testAlertId"));
  if (!id.success) return { ok: false, error: "Unknown test." };
  const r = await markTestReceived(orgId, id.data, actor.userId);
  if (r.ok) revalidatePath(`/sar/${orgId}/alerts`);
  return r;
}

export async function confirmTestCodeAction(orgId: string, _prev: TestProofResult | null, formData: FormData): Promise<TestProofResult> {
  const actor = await teamActor(orgId);
  if (!actor.ok) return actor;
  const id = rowId.safeParse(formData.get("testAlertId"));
  if (!id.success) return { ok: false, error: "Unknown test." };
  const code = testCodeSchema.safeParse(formData.get("code") ?? "");
  if (!code.success) return { ok: false, error: code.error.issues[0]?.message ?? "Enter the six digits from the test email." };
  const r = await confirmTestCode(orgId, id.data, code.data, actor.userId);
  // A wrong guess changes the tries left, so refresh either way.
  revalidatePath(`/sar/${orgId}/alerts`);
  return r;
}
