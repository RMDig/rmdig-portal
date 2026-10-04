"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { ackSarAlert, avservNodes, nodeFor } from "@/lib/avserv/sar-teams";
import { portalActor } from "@/lib/auth/portal-actor";
import { getOrgRole } from "@/lib/auth/org-roles";
import { db } from "@/lib/db";
import { sarAlertAcks, sarIntakeMessages } from "@/lib/db/schema";
import { logger } from "@/lib/logger";

// A team member marks an alert received (AvServ contacts_delete_and_sar_ack.md
// §2). Sent to every node that delivered it, each with its own ledger key;
// recorded here once any node accepts. "Received" only: it never means
// responding, and AvServ suppresses nothing because of it.

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

  const deliveries = await db
    .select({ messageId: sarIntakeMessages.messageId, node: sarIntakeMessages.node, kind: sarIntakeMessages.kind })
    .from(sarIntakeMessages)
    .where(and(eq(sarIntakeMessages.orgId, orgId), eq(sarIntakeMessages.alertId, alertId.data)));
  const primary = deliveries.filter((d) => d.kind === "overdue" || d.kind === "send_help");
  if (primary.length === 0) return { ok: false, error: "That alert isn't one of your team's." };

  const ackedAt = new Date();
  const body = { teamId: orgId, by: `portal-user:${userId}`, ackedAt: ackedAt.toISOString() };
  const nodes = avservNodes();
  const results = await Promise.all(
    primary.map(async (d) => {
      const node = nodeFor(nodes, d.node);
      if (!node) return { node: d.node, ok: false as const, code: "node_not_configured" };
      const r = await ackSarAlert(node, d.messageId, body);
      return r.ok ? { node: d.node, ok: true as const } : { node: d.node, ok: false as const, code: r.code };
    }),
  );
  const failed = results.filter((r) => !r.ok);
  for (const f of failed) logger.error({ event: "sar.ack.node_failed", orgId, alertId: alertId.data, node: f.node, code: "code" in f ? f.code : undefined });
  if (failed.length === results.length) {
    return { ok: false, error: "Couldn't record that with AvAI. Try again in a moment." };
  }

  await db.insert(sarAlertAcks).values({ orgId, alertId: alertId.data, ackedByUserId: userId, ackedAt }).onConflictDoNothing();
  logger.info({ event: "sar.ack.recorded", orgId, userId, alertId: alertId.data, nodes: results.length - failed.length });
  revalidatePath(`/sar/${orgId}/alerts`);
  return { ok: true };
}
