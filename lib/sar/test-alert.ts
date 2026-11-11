import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { avservNodes } from "../avserv/sar-teams";
import { sendSarTestAlert } from "../avserv/sar-test-alert";
import { db } from "../db";
import { type TestAlertNodeFact, sarIntakeMessages, sarTestAlerts } from "../db/schema";
import { logger } from "../logger";
import { MAX_CODE_ATTEMPTS, TEST_FRESH_DAYS, type TestAlertFact } from "./test-alert-rules";

// A team's test alert (AvServ sar_test_alert.md; plan 33 §6.9 G2 item 3; rules
// in lib/sar/test-alert-rules.ts). Staff send it to every node; each node's
// answer is stored as it came (sar_test_alerts), and the team proves each
// path on its Alerts page. AvServ never retries a test, so neither does this:
// a failed node is shown, and staff send a new test.

const DAY_MS = 86_400_000;

/** The code the email carried, hashed with its test id. Six digits are few,
 *  so the hash only keeps the code out of plain sight; the cap on guesses
 *  (MAX_CODE_ATTEMPTS) is what protects it. */
export function hashTestCode(testId: string, code: string): string {
  return createHash("sha256").update(`${testId}:${code}`).digest("hex");
}

export interface TestTeam {
  id: string;
  name: string;
  isDrill: boolean;
  oncallEmail: string | null;
  oncallEmailVerifiedAt: Date | null;
}

export type SendTestResult = { ok: true; nodes: number; failed: string[] } | { ok: false; error: string };

/** Send one test from every configured node, recording each answer. The rows
 *  are written before any call, so a test that was asked for is never lost. */
export async function sendTestAlerts(team: TestTeam, byUserId: string): Promise<SendTestResult> {
  const nodes = avservNodes();
  if (nodes.length === 0) {
    logger.error({ event: "sar.test_alert.no_avserv_nodes", orgId: team.id });
    return { ok: false, error: "No AvServ nodes are configured (AVSERV_NODE_URLS), so no test can be sent." };
  }
  const runId = randomUUID();
  const rows = nodes.map((n) => ({ runId, orgId: team.id, node: n.name, idempotencyKey: randomUUID(), requestedByUserId: byUserId }));
  const inserted = await db.insert(sarTestAlerts).values(rows).returning({ id: sarTestAlerts.id, node: sarTestAlerts.node, key: sarTestAlerts.idempotencyKey });

  // Only an address the team confirmed (G1) is ever sent to; without one the
  // node answers not_configured, which the checklist shows.
  const body = { displayName: team.name, email: team.oncallEmailVerifiedAt ? team.oncallEmail : null, drill: team.isDrill };
  const failed: string[] = [];
  await Promise.all(
    nodes.map(async (node) => {
      const row = inserted.find((r) => r.node === node.name)!;
      const r = await sendSarTestAlert(node, team.id, body, row.key);
      if (!r.ok) {
        failed.push(node.name);
        logger.error({ event: "sar.test_alert.node_failed", orgId: team.id, node: node.name, status: r.status, code: r.code });
        await db.update(sarTestAlerts).set({ errorCode: r.retryAfterSec ? `${r.code} (retry after ${r.retryAfterSec}s)` : r.code }).where(eq(sarTestAlerts.id, row.id));
        return;
      }
      const s = r.sent;
      for (const [kind, c] of [["portal", s.portal], ["email", s.email]] as const) {
        const ok = kind === "portal" ? c.result === "delivered" : c.result === "accepted";
        if (!ok) logger.error({ event: "sar.test_alert.channel_failed", orgId: team.id, node: node.name, channel: kind, result: c.result, detail: c.detail });
      }
      await db
        .update(sarTestAlerts)
        .set({
          testId: s.testId,
          avservNode: s.avservNode,
          sentAt: new Date(s.sentAt),
          portalResult: s.portal.result,
          portalDetail: s.portal.detail,
          emailResult: s.email.result,
          emailDetail: s.email.detail,
          codeHash: hashTestCode(s.testId, s.code),
        })
        .where(eq(sarTestAlerts.id, row.id));
    }),
  );
  logger.info({ event: "sar.test_alert.sent", orgId: team.id, runId, nodes: nodes.length, failed: failed.length });
  return { ok: true, nodes: nodes.length, failed };
}

export interface TestAlertRow extends TestAlertNodeFact {
  id: string;
  requestedAt: string;
  portalDetail: string | null;
  emailDetail: string | null;
  codeAttemptsLeft: number;
}

/** The latest test's rows, one per node, with whether each portal message
 *  has arrived. Empty when none was ever sent. */
export async function latestTestAlert(orgId: string): Promise<TestAlertRow[]> {
  const [latest] = await db
    .select({ runId: sarTestAlerts.runId })
    .from(sarTestAlerts)
    .where(eq(sarTestAlerts.orgId, orgId))
    .orderBy(desc(sarTestAlerts.requestedAt))
    .limit(1);
  if (!latest) return [];
  const rows = await db.select().from(sarTestAlerts).where(and(eq(sarTestAlerts.orgId, orgId), eq(sarTestAlerts.runId, latest.runId)));
  const alertIds = rows.flatMap((r) => (r.testId ? [`test:${r.testId}`] : []));
  const arrived = new Set(
    alertIds.length
      ? (
          await db
            .select({ alertId: sarIntakeMessages.alertId })
            .from(sarIntakeMessages)
            .where(and(eq(sarIntakeMessages.orgId, orgId), eq(sarIntakeMessages.kind, "test"), inArray(sarIntakeMessages.alertId, alertIds)))
        ).map((m) => m.alertId)
      : [],
  );
  return rows
    .sort((a, b) => a.node.localeCompare(b.node))
    .map((r) => ({
      id: r.id,
      node: r.node,
      requestedAt: r.requestedAt.toISOString(),
      testId: r.testId,
      error: r.testId ? null : (r.errorCode ?? "no answer"),
      portal: r.portalResult,
      email: r.emailResult,
      portalDetail: r.portalDetail,
      emailDetail: r.emailDetail,
      portalArrived: r.testId !== null && arrived.has(`test:${r.testId}`),
      portalReceived: r.portalReceivedAt !== null,
      emailConfirmed: r.emailConfirmedAt !== null,
      codeAttemptsLeft: Math.max(0, MAX_CODE_ATTEMPTS - r.codeAttempts),
    }));
}

const expired = (requestedAt: string, now: Date) => now.getTime() - new Date(requestedAt).getTime() > TEST_FRESH_DAYS * DAY_MS;

/** The latest test while it still counts (TEST_FRESH_DAYS), or none: what the
 *  team's Alerts page shows. */
export async function currentTestAlert(orgId: string, now: Date): Promise<TestAlertRow[]> {
  const rows = await latestTestAlert(orgId);
  return rows[0] && !expired(rows[0].requestedAt, now) ? rows : [];
}

/** The checklist's fact: the latest test against the nodes configured now. */
export async function testAlertFact(orgId: string, now: Date): Promise<TestAlertFact> {
  const rows = await latestTestAlert(orgId);
  const requestedAt = rows[0]?.requestedAt ?? null;
  return {
    requestedAt,
    expired: requestedAt !== null && expired(requestedAt, now),
    configuredNodes: avservNodes().map((n) => n.name),
    nodes: rows.map((r) => ({
      node: r.node,
      testId: r.testId,
      error: r.error,
      portal: r.portal,
      email: r.email,
      portalArrived: r.portalArrived,
      portalReceived: r.portalReceived,
      emailConfirmed: r.emailConfirmed,
    })),
  };
}

export type ProveResult = { ok: true } | { ok: false; error: string };

/** A member marks a node's test message received: only once it's actually
 *  at the intake, so the mark proves the message reached the team. */
export async function markTestReceived(orgId: string, rowId: string, userId: string): Promise<ProveResult> {
  const updated = await db
    .update(sarTestAlerts)
    .set({ portalReceivedAt: new Date(), portalReceivedByUserId: userId })
    .where(
      and(
        eq(sarTestAlerts.id, rowId),
        eq(sarTestAlerts.orgId, orgId),
        isNull(sarTestAlerts.portalReceivedAt),
        sql`EXISTS (SELECT 1 FROM sar_intake_messages m WHERE m.org_id = ${orgId} AND m.kind = 'test' AND m.alert_id = 'test:' || ${sarTestAlerts.testId})`,
      ),
    )
    .returning({ id: sarTestAlerts.id });
  if (updated.length === 0) return { ok: false, error: "That test message hasn't arrived, or it's already marked received." };
  logger.info({ event: "sar.test_alert.portal_received", orgId, rowId, userId });
  return { ok: true };
}

/** A member enters the code a node's test email carried. Locked per row, so
 *  concurrent guesses can't pass the cap. */
export async function confirmTestCode(orgId: string, rowId: string, code: string, userId: string): Promise<ProveResult> {
  const result = await db.transaction(async (tx): Promise<ProveResult & { attempt?: number }> => {
    const [row] = await tx
      .select({ testId: sarTestAlerts.testId, codeHash: sarTestAlerts.codeHash, attempts: sarTestAlerts.codeAttempts, confirmedAt: sarTestAlerts.emailConfirmedAt })
      .from(sarTestAlerts)
      .where(and(eq(sarTestAlerts.id, rowId), eq(sarTestAlerts.orgId, orgId)))
      .for("update")
      .limit(1);
    if (!row?.testId || !row.codeHash) return { ok: false, error: "That test isn't one of your team's." };
    if (row.confirmedAt) return { ok: true };
    if (row.attempts >= MAX_CODE_ATTEMPTS) return { ok: false, error: "Too many wrong codes for this test. Ask rmdig staff to send a new one." };
    const given = Buffer.from(hashTestCode(row.testId, code), "hex");
    const match = timingSafeEqual(given, Buffer.from(row.codeHash, "hex"));
    await tx
      .update(sarTestAlerts)
      .set(match ? { emailConfirmedAt: new Date(), emailConfirmedByUserId: userId } : { codeAttempts: row.attempts + 1 })
      .where(eq(sarTestAlerts.id, rowId));
    if (match) return { ok: true };
    const left = MAX_CODE_ATTEMPTS - row.attempts - 1;
    return { ok: false, error: left > 0 ? `That code doesn't match. ${left} ${left === 1 ? "try" : "tries"} left.` : "That code doesn't match, and that was the last try. Ask rmdig staff to send a new test.", attempt: row.attempts + 1 };
  });
  logger.info({ event: result.ok ? "sar.test_alert.email_confirmed" : "sar.test_alert.code_refused", orgId, rowId, userId, attempt: result.ok ? undefined : result.attempt });
  if (result.ok) return { ok: true };
  return { ok: false, error: result.error };
}
