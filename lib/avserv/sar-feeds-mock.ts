import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { sarAlertAcks, sarIntakeMessages } from "../db/schema";
import type { IntakePayload } from "../sar/intake";
import type { RedItem } from "./sar-feeds";

// The mock AvServ RED feed (AVSERV_BASE_URL=mock://, previews and local dev):
// it answers from the alerts the portal's intake holds for the team, the way
// the real feed reports what AvServ sent it. With the preview demo world
// (lib/preview-demo.ts) the map's red layer has something to show; with no
// alerts it's empty, as the real feed would be.

const PRIMARY = new Set(["overdue", "send_help"]);

export async function mockRedFeed(orgId: string): Promise<RedItem[]> {
  const rows = await db
    .select()
    .from(sarIntakeMessages)
    .where(and(eq(sarIntakeMessages.orgId, orgId), eq(sarIntakeMessages.drill, false)));
  const acks = new Map(
    (await db.select().from(sarAlertAcks).where(eq(sarAlertAcks.orgId, orgId))).map((a) => [a.alertId, a]),
  );
  const byAlert = new Map<string, typeof rows>();
  for (const r of rows) byAlert.set(r.alertId, [...(byAlert.get(r.alertId) ?? []), r]);

  const items: RedItem[] = [];
  for (const [alertId, msgs] of byAlert) {
    const primary = msgs.filter((m) => PRIMARY.has(m.kind)).sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
    const first = primary[0];
    if (!first) continue;
    const p = primary[primary.length - 1]!.payload as Extract<IntakePayload, { kind: "overdue" | "send_help" }>;
    const close = msgs.find((m) => m.kind === "all_clear" || m.kind === "disregard");
    const ack = acks.get(alertId);
    items.push({
      itemId: alertId,
      kind: p.kind,
      status: !close ? "open" : close.kind === "all_clear" ? "resolved" : "retracted",
      userDisplayName: p.alert.userDisplayName,
      lastFix: p.alert.lastFix,
      plannedRoute: p.kind === "overdue" ? ((p.alert.plannedRoute as RedItem["plannedRoute"]) ?? null) : null,
      expectedReturnAt: p.kind === "overdue" ? p.alert.expectedReturnAt : null,
      note: p.kind === "send_help" ? p.alert.note : null,
      deliveries: primary.map((m) => ({ node: m.node, ledgerKey: m.messageId, channels: ["portal"], deliveredAt: m.receivedAt.toISOString() })),
      ack: ack ? { at: ack.ackedAt.toISOString(), by: `portal-user:${ack.ackedByUserId ?? "unknown"}` } : null,
      openedAt: first.sentAt.toISOString(),
      resolvedAt: close ? close.sentAt.toISOString() : null,
    });
  }
  return items;
}
