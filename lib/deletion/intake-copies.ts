import { and, eq, inArray, or } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import { readShareLog, type ShareLogResult } from "../avserv/share-log";
import { avservNodes } from "../avserv/sar-teams";
import { db } from "../db";
import { sarAlertAcks, sarIntakeMessages } from "../db/schema";
import { logger } from "../logger";

// An erasure reaches the portal's copies of the account's alerts (plan 33
// §6.9, F6). Each intake message about an alert carries AvServ's alert id,
// `<subject>:<teamId>` (sardispatch), and every node's data_share_log names
// the subject and team of each dispatch it made for the account. The log
// outlives the erasure (it is the record of whom to tell), so this runs once
// every node reports the account erased: never while an erasure is held
// behind a live check-out, whose alert a team may still be working.
//
// Drill dispatches count too: a drill team's copy still carries a real
// login's name. Feed reads (the RED map) leave no copy here.

export interface AlertKey {
  orgId: string;
  alertId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The (team, alert id) pairs the account's dispatches made, from every
 *  node's log. Pure. A node that didn't answer makes it incomplete: its
 *  dispatches may name alerts no other node sent. */
export function alertKeysFromShareLog(results: ShareLogResult[]): {
  keys: AlertKey[];
  unavailable: Array<{ node: string; code: string }>;
} {
  const seen = new Map<string, AlertKey>();
  for (const r of results) {
    if (!r.ok) continue;
    for (const i of r.items) {
      // A team id that isn't a uuid can't be one of our orgs (and would fail
      // the column's cast): it's off-contract, so it's logged, never matched.
      if (i.kind !== "dispatch") continue;
      if (!UUID.test(i.teamId)) {
        logger.error({ event: "deletion.intake_copies.bad_team_id", node: r.node, teamId: i.teamId });
        continue;
      }
      const alertId = `${i.subject}:${i.teamId}`;
      seen.set(`${i.teamId}|${alertId}`, { orgId: i.teamId, alertId });
    }
  }
  return { keys: [...seen.values()], unavailable: results.flatMap((r) => (r.ok ? [] : [{ node: r.node, code: r.code }])) };
}

export type IntakeCopiesResult =
  | { status: "complete" | "incomplete"; alerts: number; messagesDeleted: number; acksDeleted: number; unavailable: Array<{ node: string; code: string }> }
  | { status: "error"; error: string };

/** Delete the portal's copies of an erased account's alerts: every intake
 *  message (their team emails go with them) and every ack. Idempotent, so a
 *  status re-check finishes what an incomplete run left. */
export async function deleteIntakeCopies(accountId: string, requestId: string): Promise<IntakeCopiesResult> {
  const nodes = avservNodes();
  if (nodes.length === 0) {
    logger.error({ event: "deletion.intake_copies.no_avserv_nodes", requestId });
    return { status: "error", error: "No AvAI servers are configured, so the portal's copies can't be found." };
  }
  const { keys, unavailable } = alertKeysFromShareLog(await Promise.all(nodes.map((n) => readShareLog(n, accountId))));
  for (const u of unavailable) logger.error({ event: "deletion.intake_copies.node_failed", requestId, node: u.node, code: u.code });
  if (unavailable.length === nodes.length) {
    return { status: "error", error: "No AvAI server answered for the share log, so the portal's copies weren't found. Re-check the status to try again." };
  }

  let messagesDeleted = 0;
  let acksDeleted = 0;
  if (keys.length) {
    const match = (orgId: PgColumn, alertId: PgColumn) => or(...keys.map((k) => and(eq(orgId, k.orgId), eq(alertId, k.alertId))));
    // Narrowed by team first, so the OR list only filters a few rows.
    const orgIds = [...new Set(keys.map((k) => k.orgId))];
    ({ messagesDeleted, acksDeleted } = await db.transaction(async (tx) => {
      const m = await tx
        .delete(sarIntakeMessages)
        .where(and(inArray(sarIntakeMessages.orgId, orgIds), match(sarIntakeMessages.orgId, sarIntakeMessages.alertId)))
        .returning({ id: sarIntakeMessages.messageId });
      const a = await tx
        .delete(sarAlertAcks)
        .where(and(inArray(sarAlertAcks.orgId, orgIds), match(sarAlertAcks.orgId, sarAlertAcks.alertId)))
        .returning({ id: sarAlertAcks.alertId });
      return { messagesDeleted: m.length, acksDeleted: a.length };
    }));
  }
  const status = unavailable.length ? "incomplete" : "complete";
  logger.info({ event: "deletion.intake_copies.deleted", requestId, status, alerts: keys.length, messagesDeleted, acksDeleted });
  return { status, alerts: keys.length, messagesDeleted, acksDeleted, unavailable };
}

/** The portal's line for the completion note. */
export function intakeCopiesNoteText(r: IntakeCopiesResult): string {
  if (r.status === "error") return `Portal: alert copies NOT deleted (${r.error})`;
  const what = `deleted ${r.messagesDeleted} intake message${r.messagesDeleted === 1 ? "" : "s"} and ${r.acksDeleted} ack${r.acksDeleted === 1 ? "" : "s"} for ${r.alerts} alert${r.alerts === 1 ? "" : "s"}`;
  return r.status === "complete"
    ? `Portal: ${what} (share log read from every node).`
    : `Portal: ${what}, but ${r.unavailable.map((u) => `${u.node} (${u.code})`).join(", ")} didn't answer: re-check the status to finish.`;
}
