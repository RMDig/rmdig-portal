import { and, eq, inArray, or } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import { readShareLog, type ShareLogResult } from "../avserv/share-log";
import { avservNodes } from "../avserv/sar-teams";
import { db } from "../db";
import { sarAlertAcks, sarApprovalDecisions, sarIntakeMessages } from "../db/schema";
import { logger } from "../logger";

// An erasure reaches the portal's copies of the account's data (plan 33
// §6.9, F6), found from every node's data_share_log (sar_feeds.md §4):
//
// - Alerts. Each intake message about an alert carries AvServ's alert id,
//   `<subject>:<teamId>` (sardispatch), and the log names the subject and
//   team of each dispatch made for the account.
// - Approval decisions (plan 33 9.8). Each time a confirm-first team's list
//   showed the account, the log names the team and the acceptance id. A
//   decision is only ever made from that list, so every decision's acceptance
//   was logged. The log keeps 365 days (plan 41 §10.4): a decision on an
//   acceptance no team has viewed for a year isn't found.
//
// The log outlives the erasure (it is the record of whom to tell), so this
// runs once every node reports the account erased: never while an erasure is
// held behind a live check-out, whose alert a team may still be working.
//
// Drill dispatches count too: a drill team's copy still carries a real
// login's name. Feed and area-map reads leave no copy here.

export interface AlertKey {
  orgId: string;
  alertId: string;
}

export interface AcceptanceKey {
  orgId: string;
  acceptanceId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The (team, alert id) and (team, acceptance id) pairs the account's
 *  disclosures name, from every node's log. Pure. A node that didn't answer
 *  makes it incomplete: it may name alerts or acceptances no other node did. */
export function copyKeysFromShareLog(results: ShareLogResult[]): {
  alerts: AlertKey[];
  acceptances: AcceptanceKey[];
  unavailable: Array<{ node: string; code: string }>;
} {
  const alerts = new Map<string, AlertKey>();
  const acceptances = new Map<string, AcceptanceKey>();
  for (const r of results) {
    if (!r.ok) continue;
    for (const i of r.items) {
      if (i.kind !== "dispatch" && i.kind !== "approval_request") continue;
      // A team id that isn't a uuid can't be one of our orgs (and would fail
      // the column's cast): it's off-contract, so it's logged, never matched.
      if (!UUID.test(i.teamId)) {
        logger.error({ event: "deletion.intake_copies.bad_team_id", node: r.node, teamId: i.teamId });
        continue;
      }
      if (i.kind === "dispatch") {
        const alertId = `${i.subject}:${i.teamId}`;
        alerts.set(`${i.teamId}|${alertId}`, { orgId: i.teamId, alertId });
      } else {
        acceptances.set(`${i.teamId}|${i.subject}`, { orgId: i.teamId, acceptanceId: i.subject });
      }
    }
  }
  return {
    alerts: [...alerts.values()],
    acceptances: [...acceptances.values()],
    unavailable: results.flatMap((r) => (r.ok ? [] : [{ node: r.node, code: r.code }])),
  };
}

export type IntakeCopiesResult =
  | {
      status: "complete" | "incomplete";
      alerts: number;
      messagesDeleted: number;
      acksDeleted: number;
      decisionsDeleted: number;
      unavailable: Array<{ node: string; code: string }>;
    }
  | { status: "error"; error: string };

/** Delete the portal's copies of an erased account's data: every intake
 *  message about its alerts (their team emails go with them), every ack, and
 *  every team's approval decision on it. Idempotent, so a status re-check
 *  finishes what an incomplete run left. */
export async function deleteIntakeCopies(accountId: string, requestId: string): Promise<IntakeCopiesResult> {
  const nodes = avservNodes();
  if (nodes.length === 0) {
    logger.error({ event: "deletion.intake_copies.no_avserv_nodes", requestId });
    return { status: "error", error: "No AvAI servers are configured, so the portal's copies can't be found." };
  }
  const { alerts, acceptances, unavailable } = copyKeysFromShareLog(await Promise.all(nodes.map((n) => readShareLog(n, accountId))));
  for (const u of unavailable) logger.error({ event: "deletion.intake_copies.node_failed", requestId, node: u.node, code: u.code });
  if (unavailable.length === nodes.length) {
    return { status: "error", error: "No AvAI server answered for the share log, so the portal's copies weren't found. Re-check the status to try again." };
  }

  // Each OR list is narrowed by team first, so it only filters a few rows.
  const match = <K extends { orgId: string }>(keys: K[], orgId: PgColumn, id: PgColumn, idOf: (k: K) => string) =>
    and(inArray(orgId, [...new Set(keys.map((k) => k.orgId))]), or(...keys.map((k) => and(eq(orgId, k.orgId), eq(id, idOf(k))))));
  const { messagesDeleted, acksDeleted, decisionsDeleted } = await db.transaction(async (tx) => {
    let messagesDeleted = 0;
    let acksDeleted = 0;
    let decisionsDeleted = 0;
    if (alerts.length) {
      const m = await tx
        .delete(sarIntakeMessages)
        .where(match(alerts, sarIntakeMessages.orgId, sarIntakeMessages.alertId, (k) => k.alertId))
        .returning({ id: sarIntakeMessages.messageId });
      const a = await tx
        .delete(sarAlertAcks)
        .where(match(alerts, sarAlertAcks.orgId, sarAlertAcks.alertId, (k) => k.alertId))
        .returning({ id: sarAlertAcks.alertId });
      messagesDeleted = m.length;
      acksDeleted = a.length;
    }
    if (acceptances.length) {
      const d = await tx
        .delete(sarApprovalDecisions)
        .where(match(acceptances, sarApprovalDecisions.orgId, sarApprovalDecisions.acceptanceId, (k) => k.acceptanceId))
        .returning({ id: sarApprovalDecisions.id });
      decisionsDeleted = d.length;
    }
    return { messagesDeleted, acksDeleted, decisionsDeleted };
  });
  const status = unavailable.length ? "incomplete" : "complete";
  logger.info({ event: "deletion.intake_copies.deleted", requestId, status, alerts: alerts.length, messagesDeleted, acksDeleted, decisionsDeleted });
  return { status, alerts: alerts.length, messagesDeleted, acksDeleted, decisionsDeleted, unavailable };
}

const n = (count: number, what: string) => `${count} ${what}${count === 1 ? "" : "s"}`;

/** The portal's line for the completion note. */
export function intakeCopiesNoteText(r: IntakeCopiesResult): string {
  if (r.status === "error") return `Portal: alert copies NOT deleted (${r.error})`;
  const what = `deleted ${n(r.messagesDeleted, "intake message")} and ${n(r.acksDeleted, "ack")} for ${n(r.alerts, "alert")}, and ${n(r.decisionsDeleted, "approval decision")}`;
  return r.status === "complete"
    ? `Portal: ${what} (share log read from every node).`
    : `Portal: ${what}, but ${r.unavailable.map((u) => `${u.node} (${u.code})`).join(", ")} didn't answer: re-check the status to finish.`;
}
