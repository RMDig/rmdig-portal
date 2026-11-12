"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { portalActor } from "@/lib/auth/portal-actor";
import { hasPlatformRole } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { sarOrgs } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { latestTestAlert, sendTestAlerts } from "@/lib/sar/test-alert";
import { TEST_RESEND_AFTER_MS } from "@/lib/sar/test-alert-rules";

// An rmdig admin sends a drill team AvServ's test alert from every node
// (plan 37; AvServ sar_test_alert.md, plan 66 R1). A drill team is never
// reviewed, so this is not checklist item 3 and decides nothing: it proves
// each node's test route, the portal's drill intake and the drill email end
// to end. The nodes send a drill team's message to the drill intake
// (/api/sar/intake/drill) and its email to the drill inbox, never to a team
// address. A real team's test stays the
// approver's, during review (admin/sar-approvals/test-alert-actions.ts).

export type SendDrillTestResult = { ok: true; message: string } | { ok: false; error: string };

export async function sendDrillTestAlertAction(_prev: SendDrillTestResult | null, formData: FormData): Promise<SendDrillTestResult> {
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  const userId = actor.userId;
  if (!(await hasPlatformRole(userId, "rmdig_admin"))) return { ok: false, error: "Only rmdig admins manage drill teams." };
  const orgId = z.string().uuid().safeParse(formData.get("orgId"));
  if (!orgId.success) return { ok: false, error: "Unknown drill team." };

  const [org] = await db
    .select({
      id: sarOrgs.id,
      name: sarOrgs.name,
      status: sarOrgs.status,
      isDrill: sarOrgs.isDrill,
      oncallEmail: sarOrgs.oncallEmail,
      oncallEmailVerifiedAt: sarOrgs.oncallEmailVerifiedAt,
    })
    .from(sarOrgs)
    .where(eq(sarOrgs.id, orgId.data))
    .limit(1);
  if (!org) return { ok: false, error: "That drill team no longer exists." };
  if (!org.isDrill) {
    // A real team is tested only by an approver during its review.
    logger.warn({ event: "sar.test_alert.drill_refused_real", userId, orgId: org.id });
    return { ok: false, error: "That isn't a drill team. A real team is tested from the approvals queue, during review." };
  }
  if (org.status === "rejected" || org.status === "withdrawn") return { ok: false, error: `This drill team is ${org.status}.` };
  const [last] = await latestTestAlert(org.id);
  if (last && Date.now() - new Date(last.requestedAt).getTime() < TEST_RESEND_AFTER_MS) {
    return { ok: false, error: "A test was sent less than a minute ago. Wait for its results." };
  }

  const sent = await sendTestAlerts(org, userId);
  revalidatePath("/admin/sar-drill");
  if (!sent.ok) return { ok: false, error: sent.error };
  if (sent.failed.length === sent.nodes) return { ok: false, error: `No node sent the test (${sent.failed.join(", ")}). The results are below.` };
  return {
    ok: true,
    message: sent.failed.length
      ? `Sent from ${sent.nodes - sent.failed.length} of ${sent.nodes} nodes; ${sent.failed.join(", ")} failed (below).`
      : `Sent from ${sent.nodes} node${sent.nodes === 1 ? "" : "s"}. Each code goes to the drill inbox; a drill login enters it on the team's Alerts page.`,
  };
}
