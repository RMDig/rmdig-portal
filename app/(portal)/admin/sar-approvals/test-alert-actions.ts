"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { portalActor } from "@/lib/auth/portal-actor";
import { getOrgRole } from "@/lib/auth/org-roles";
import { isSarApprover } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { sarOrgs } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { latestTestAlert, sendTestAlerts } from "@/lib/sar/test-alert";
import { TEST_RESEND_AFTER_MS } from "@/lib/sar/test-alert-rules";

// Staff send a pending team AvServ's test alert from every node (plan 33 §6.9
// G2 item 3; AvServ sar_test_alert.md). It verifies the team, so it's the
// approver's step, under the approver's rules: SAR approvers only, never for
// an org they submitted or belong to. A drill team is never reviewed (plan 37
// rule 6), so it has no checklist to send for: its test is sent from Drill
// teams (admin/sar-drill/test-alert-actions.ts).

export type SendTestAlertResult = { ok: true; message: string } | { ok: false; error: string };

export async function sendTestAlertAction(_prev: SendTestAlertResult | null, formData: FormData): Promise<SendTestAlertResult> {
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  const userId = actor.userId;
  if (!(await isSarApprover(userId))) return { ok: false, error: "You don't have access to the approvals queue." };
  const orgId = z.string().uuid().safeParse(formData.get("orgId"));
  if (!orgId.success) return { ok: false, error: "Unknown organization." };

  const [org] = await db
    .select({
      id: sarOrgs.id,
      name: sarOrgs.name,
      status: sarOrgs.status,
      isDrill: sarOrgs.isDrill,
      createdByUserId: sarOrgs.createdByUserId,
      oncallEmail: sarOrgs.oncallEmail,
      oncallEmailVerifiedAt: sarOrgs.oncallEmailVerifiedAt,
    })
    .from(sarOrgs)
    .where(eq(sarOrgs.id, orgId.data))
    .limit(1);
  if (!org) return { ok: false, error: "That organization no longer exists." };
  if (org.isDrill) return { ok: false, error: "A drill team isn't reviewed. Manage it from Drill teams." };
  if (org.status !== "pending") return { ok: false, error: `A test is part of the review, and this organization is ${org.status}.` };
  if (org.createdByUserId === userId || (await getOrgRole(userId, org.id))) {
    logger.warn({ event: "sar.test_alert.conflict_refused", userId, orgId: org.id });
    return { ok: false, error: "You submitted or belong to this organization, so another approver has to test it." };
  }
  const [last] = await latestTestAlert(org.id);
  if (last && Date.now() - new Date(last.requestedAt).getTime() < TEST_RESEND_AFTER_MS) {
    return { ok: false, error: "A test was sent less than a minute ago. Wait for its results." };
  }

  const sent = await sendTestAlerts(org, userId);
  revalidatePath("/admin/sar-approvals");
  if (!sent.ok) return { ok: false, error: sent.error };
  if (sent.failed.length === sent.nodes) return { ok: false, error: `No node sent the test (${sent.failed.join(", ")}). The results are below.` };
  return {
    ok: true,
    message: sent.failed.length
      ? `Sent from ${sent.nodes - sent.failed.length} of ${sent.nodes} nodes; ${sent.failed.join(", ")} failed (below). Ask the team to confirm what arrived.`
      : `Sent from ${sent.nodes} node${sent.nodes === 1 ? "" : "s"}. Ask the team to confirm each message on its Alerts page.`,
  };
}
