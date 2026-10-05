import { sql } from "drizzle-orm";

import { db } from "../db";
import { logger } from "../logger";

// Retention for the portal's own copy of SAR team alerts (owner decision
// 2026-10-05, in counsel tranche 1 as a working decision), matching AvServ's
// team feed: an alert's position and planned route are removed 24 hours after
// it ends, and the alert, its follow-ups and its "received" record 90 days
// after it ends. The views of the alerts page and map are kept 12 months, like
// AvServ's disclosure record. An alert "ends" with its all-clear or retraction;
// one that never ends is kept, and flagged after 30 days so a lost follow-up
// can't hold data quietly.

export const POSITION_HOURS = 24;
export const ALERT_DAYS = 90;
export const VIEW_LOG_DAYS = 365;
export const STALE_OPEN_DAYS = 30;

export interface SarRetentionSummary {
  positionsRemoved: number;
  alertMessagesDeleted: number;
  acksDeleted: number;
  viewLogsDeleted: number;
  staleOpenAlerts: number;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

// When each alert ended: the latest all-clear or retraction received for it.
const ENDED = sql`
  SELECT alert_id, org_id, max(sent_at) AS ended_at
  FROM sar_intake_messages
  WHERE kind IN ('all_clear', 'disregard')
  GROUP BY alert_id, org_id`;

export async function runSarRetention(now: Date): Promise<SarRetentionSummary> {
  // Bound as ISO strings: the driver takes no Date parameters in raw SQL.
  const positionCut = new Date(now.getTime() - POSITION_HOURS * HOUR_MS);
  const alertCut = new Date(now.getTime() - ALERT_DAYS * DAY_MS);
  const viewCut = new Date(now.getTime() - VIEW_LOG_DAYS * DAY_MS);
  const staleCut = new Date(now.getTime() - STALE_OPEN_DAYS * DAY_MS);

  const summary = await db.transaction(async (tx) => {
    const positions = await tx.execute(sql`
      WITH ended AS (${ENDED})
      UPDATE sar_intake_messages m
      SET payload = jsonb_set(jsonb_set(m.payload, '{alert,lastFix}', 'null'::jsonb), '{alert,plannedRoute}', 'null'::jsonb)
      FROM ended e
      WHERE m.alert_id = e.alert_id AND m.org_id = e.org_id
        AND m.kind IN ('overdue', 'send_help')
        AND e.ended_at < ${positionCut.toISOString()}::timestamptz
        AND (coalesce(m.payload->'alert'->'lastFix', 'null'::jsonb) <> 'null'::jsonb
          OR coalesce(m.payload->'alert'->'plannedRoute', 'null'::jsonb) <> 'null'::jsonb)
      RETURNING 1`);
    // Acks first: the messages they hang off decide which alerts have ended.
    const acks = await tx.execute(sql`
      WITH ended AS (${ENDED})
      DELETE FROM sar_alert_acks a USING ended e
      WHERE a.alert_id = e.alert_id AND a.org_id = e.org_id AND e.ended_at < ${alertCut.toISOString()}::timestamptz
      RETURNING 1`);
    const messages = await tx.execute(sql`
      WITH ended AS (${ENDED})
      DELETE FROM sar_intake_messages m USING ended e
      WHERE m.alert_id = e.alert_id AND m.org_id = e.org_id AND e.ended_at < ${alertCut.toISOString()}::timestamptz
      RETURNING 1`);
    const alertViews = await tx.execute(sql`DELETE FROM sar_alert_view_log WHERE viewed_at < ${viewCut.toISOString()}::timestamptz RETURNING 1`);
    const mapViews = await tx.execute(sql`DELETE FROM sar_map_view_log WHERE viewed_at < ${viewCut.toISOString()}::timestamptz RETURNING 1`);
    const stale = await tx.execute<{ n: number }>(sql`
      SELECT count(DISTINCT (m.alert_id, m.org_id))::int AS n
      FROM sar_intake_messages m
      WHERE m.kind IN ('overdue', 'send_help') AND m.received_at < ${staleCut.toISOString()}::timestamptz
        AND NOT EXISTS (
          SELECT 1 FROM sar_intake_messages f
          WHERE f.alert_id = m.alert_id AND f.org_id = m.org_id AND f.kind IN ('all_clear', 'disregard'))`);
    return {
      positionsRemoved: positions.length,
      alertMessagesDeleted: messages.length,
      acksDeleted: acks.length,
      viewLogsDeleted: alertViews.length + mapViews.length,
      staleOpenAlerts: Number([...stale][0]?.n ?? 0),
    };
  });
  if (summary.staleOpenAlerts > 0) {
    // Kept, not purged (an open alert may still matter), but someone should
    // find out why its all-clear never arrived.
    logger.error({ event: "sar.retention.stale_open_alerts", count: summary.staleOpenAlerts, days: STALE_OPEN_DAYS });
  }
  return summary;
}
