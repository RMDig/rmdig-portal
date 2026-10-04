"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { ackSarAlert, avservNodes } from "@/lib/avserv/sar-teams";
import { portalActor } from "@/lib/auth/portal-actor";
import { getOrgRole } from "@/lib/auth/org-roles";
import { db } from "@/lib/db";
import { sarAlertAcks, sarIntakeMessages } from "@/lib/db/schema";
import { logger } from "@/lib/logger";

// A team member marks an alert received (AvServ contacts_delete_and_sar_ack.md
// §2). Sent to every node under the alert id they all share; recorded here
// once any node accepts. "Received" only: it never means responding, and
// AvServ suppresses nothing because of it.

export type AckResult = { ok: true } | { ok: false; error: string };

export async function ackAlertAction(orgId: string, _prev: AckResult | null, formData: FormData): Promise<AckResult> {
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  const userId = actor.userId;
  const role = await getOrgRole(userId, orgId);
  if (role !== "admin" && role !== "dispatcher") {
    return { ok: false, error: "Only your team's admins and dispatchers can mark alerts received." };
  }
  const alertId = z.string().min(1).max(300).safeParse(formData.get("alertId"));
  if (!alertId.success) return { ok: false, error: "Unknown alert." };

  // Only an alert AvAI actually sent this team can be acked from here.
  const [delivered] = await db
    .select({ messageId: sarIntakeMessages.messageId })
    .from(sarIntakeMessages)
    .where(
      and(
        eq(sarIntakeMessages.orgId, orgId),
        eq(sarIntakeMessages.alertId, alertId.data),
        inArray(sarIntakeMessages.kind, ["overdue", "send_help"]),
      ),
    )
    .limit(1);
  if (!delivered) return { ok: false, error: "That alert isn't one of your team's." };

  const body = { teamId: orgId, by: `portal-user:${userId}` };
  const nodes = avservNodes();
  if (nodes.length === 0) {
    logger.error({ event: "sar.ack.no_avserv_nodes", orgId });
    return { ok: false, error: "Couldn't record that with AvAI. Try again in a moment." };
  }
  const results = await Promise.all(
    nodes.map(async (node) => {
      const r = await ackSarAlert(node, alertId.data, body);
      return r.ok ? { node: node.name, ok: true as const, at: r.at } : { node: node.name, ok: false as const, code: r.code };
    }),
  );
  const failed = results.filter((r) => !r.ok);
  for (const f of failed) logger.error({ event: "sar.ack.node_failed", orgId, alertId: alertId.data, node: f.node, code: "code" in f ? f.code : undefined });
  if (failed.length === results.length) {
    return { ok: false, error: "Couldn't record that with AvAI. Try again in a moment." };
  }

  // AvServ's time (the earliest ack wins); our clock only if no node said.
  const ats = results.flatMap((r) => (r.ok && r.at ? [r.at] : [])).sort();
  const ackedAt = ats[0] ? new Date(ats[0]) : new Date();
  await db.insert(sarAlertAcks).values({ orgId, alertId: alertId.data, ackedByUserId: userId, ackedAt }).onConflictDoNothing();
  logger.info({ event: "sar.ack.recorded", orgId, userId, alertId: alertId.data, nodes: results.length - failed.length });
  revalidatePath(`/sar/${orgId}/alerts`);
  return { ok: true };
}
