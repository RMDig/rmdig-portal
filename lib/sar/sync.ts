import * as Sentry from "@sentry/nextjs";
import { and, desc, eq, sql } from "drizzle-orm";

import { readFleetRevision } from "../avserv/sar-capabilities";
import { avservNodes, putSarTeam } from "../avserv/sar-teams";
import { db } from "../db";
import { sarOrgs, sarOrgSync, sarOrgTerms } from "../db/schema";
import { logger } from "../logger";
import { reportError, reportProblem } from "../report-error";
import { buildDeviceArea, type DeviceServiceArea } from "./device-area";
import { RegionPolygonSchema, SYNC_DECIMALS, SYNC_SIMPLIFY_DEGREES } from "./geo";
import { readTeamRecovery } from "./recovery";
import {
  DEVICE_AREA_SYNC_REVISION,
  DRILL_SYNC_REVISION,
  hasCheckoutSettings,
  planSync,
  SETTINGS_SYNC_REVISION,
  type SkipReason,
} from "./sync-body";

// Send a SAR org's current state to every AvServ node (sar_team_sync.md).
// Called after each decision that changes what AvServ must know (approve,
// suspend, leaving, withdraw, re-verify, terms publish) and from the staff
// resync button. The decision itself is already committed: a node that fails
// is logged loudly, recorded per node and shown to staff, never rolled back
// into the decision. A failed node also converges from its peer by
// replication once the other node accepted the PUT.

// AvServ's permanent refusals of a drill sync: a team it won't accept as a
// drill (422), or one whose drill flag would flip (409).
export const DRILL_REFUSALS: ReadonlySet<string> = new Set(["drill_team_invalid", "sar_team_drill_immutable"]);

export type NodeOutcome =
  | { node: string; outcome: "ok"; applied: boolean; usable: boolean; unusableReason: string | null }
  | { node: string; outcome: "error"; code: string }
  | { node: string; outcome: "skipped"; reason: SkipReason };

export async function syncSarOrg(orgId: string): Promise<NodeOutcome[]> {
  const nodes = avservNodes();
  if (nodes.length === 0) {
    logger.error({ event: "sar.sync.no_nodes", orgId });
    return [];
  }

  const [org] = await db.select().from(sarOrgs).where(eq(sarOrgs.id, orgId)).limit(1);
  if (!org) throw new Error(`syncSarOrg: unknown org ${orgId}`);

  const [areaRow] = (await db.execute(sql`
    SELECT ST_AsGeoJSON(ST_SimplifyPreserveTopology(region_geom::geometry, ${SYNC_SIMPLIFY_DEGREES}), ${SYNC_DECIMALS}::int)::text AS geojson
    FROM sar_orgs WHERE id = ${orgId}
  `)) as unknown as Array<{ geojson: string | null }>;
  const region = areaRow?.geojson ? RegionPolygonSchema.parse(JSON.parse(areaRow.geojson)) : null;
  const area = region?.coordinates ?? null;

  const [terms] = await db
    .select()
    .from(sarOrgTerms)
    .where(and(eq(sarOrgTerms.orgId, orgId), eq(sarOrgTerms.status, "published")))
    .orderBy(desc(sarOrgTerms.version))
    .limit(1);

  // What the whole fleet understands decides the gated fields: a drill team
  // waits for revision 3 (plan 37 §4.5), a team with check-out settings for
  // revision 2 (plan 33 §6.2). The revision 4 fields (AvApp plan 68) hold no
  // team back: below 4 they're left out.
  const fleet = await readFleetRevision(nodes);
  const needs = Math.max(org.isDrill ? DRILL_SYNC_REVISION : 0, hasCheckoutSettings(org) ? SETTINGS_SYNC_REVISION : 0);
  if (fleet.revision < needs) {
    logger.warn({ event: org.isDrill ? "sar.sync.drill_held" : "sar.sync.settings_held", orgId, needs, nodes: fleet.nodes });
  }
  const deviceArea = region && fleet.revision >= DEVICE_AREA_SYNC_REVISION ? await deviceCopy(orgId, region) : null;

  const now = new Date();
  const preview = planSync(
    org,
    area,
    terms?.version && terms.sha256 && terms.publishedAt && terms.requiresReacceptance !== null
      ? {
          version: terms.version,
          sha256: terms.sha256,
          publishedAt: terms.publishedAt,
          body: terms.body,
          requiresReacceptance: terms.requiresReacceptance,
          capabilities: terms.capabilities,
        }
      : null,
    0,
    now,
    fleet.revision,
    deviceArea,
  );

  if (!preview.send) {
    await record(orgId, nodes.map((n) => ({ node: n.name, outcome: "skipped" as const, reason: preview.reason })), org.syncRevision, now);
    logger.info({ event: "sar.sync.skipped", orgId, reason: preview.reason });
    return nodes.map((n) => ({ node: n.name, outcome: "skipped", reason: preview.reason }));
  }

  // Every change gets a new revision; AvServ keeps the highest per node.
  const [bumped] = await db
    .update(sarOrgs)
    .set({ syncRevision: sql`${sarOrgs.syncRevision} + 1` })
    .where(eq(sarOrgs.id, orgId))
    .returning({ revision: sarOrgs.syncRevision });
  const body = { ...preview.body, revision: bumped!.revision };

  const outcomes: NodeOutcome[] = await Promise.all(
    nodes.map(async (n): Promise<NodeOutcome> => {
      const r = await putSarTeam(n, body);
      if (r.ok) {
        return { node: n.name, outcome: "ok", applied: r.result.applied, usable: r.result.usable, unusableReason: r.result.unusableReason };
      }
      logger.error({ event: "sar.sync.node_failed", orgId, node: n.name, revision: body.revision, status: r.status, code: r.code, detail: r.detail });
      // A drill refusal means the portal and the node disagree on what a
      // drill team is, so a person looks at it. Never retried.
      if (DRILL_REFUSALS.has(r.code)) {
        Sentry.captureMessage(`AvServ refused a SAR team sync: ${r.code}`, {
          level: "error",
          tags: { event: "sar.sync.drill_refused", code: r.code, node: n.name },
          extra: { orgId, revision: body.revision, drill: body.drill === true },
        });
      }
      return { node: n.name, outcome: "error", code: r.code };
    }),
  );
  await record(orgId, outcomes, body.revision, now);
  // Never the area or its copy: the log carries no coordinates (AvApp plan 68 d).
  logger.info({
    event: "sar.sync.sent",
    orgId,
    revision: body.revision,
    status: body.status,
    fleetRevision: fleet.revision,
    deviceArea: body.deviceServiceArea !== undefined,
    outcomes: outcomes.map((o) => `${o.node}:${o.outcome}`),
  });
  // Then each node's own view: what it would need to use the team, and what
  // it holds back meanwhile (plan 33 §6.9 F4). Never throws.
  await readTeamRecovery(orgId);
  return outcomes;
}

/** The team's device copy, or null, loudly. The area check refuses an area
 *  whose copy fails before it's saved, so a failure here is a team saved
 *  before that check, or a portal bug. The team still syncs, without the copy:
 *  the phone then knows no shape for it, the safe side, and a suspension or
 *  any other change is never held back by it. */
async function deviceCopy(orgId: string, region: Parameters<typeof buildDeviceArea>[0]): Promise<DeviceServiceArea | null> {
  try {
    const result = await buildDeviceArea(region);
    if (result.ok) return result.deviceArea;
    reportProblem("sar.sync.device_area_failed", "A team's phone copy of its area couldn't be built; synced without it", {
      orgId,
      reason: result.reason,
      points: result.points ?? "none",
    });
  } catch (err) {
    reportError("sar.sync.device_area_failed", err, { orgId });
  }
  return null;
}

async function record(orgId: string, outcomes: NodeOutcome[], revision: number, now: Date): Promise<void> {
  for (const o of outcomes) {
    const values = {
      orgId,
      node: o.node,
      revision,
      outcome: o.outcome,
      usable: o.outcome === "ok" ? o.usable : null,
      unusableReason: o.outcome === "ok" ? o.unusableReason : o.outcome === "skipped" ? o.reason : null,
      errorCode: o.outcome === "error" ? o.code : null,
      attemptedAt: now,
    };
    await db
      .insert(sarOrgSync)
      .values({ ...values, syncedAt: o.outcome === "ok" ? now : null })
      .onConflictDoUpdate({
        target: [sarOrgSync.orgId, sarOrgSync.node],
        // A failed attempt keeps the last successful syncedAt.
        set: o.outcome === "ok" ? { ...values, syncedAt: now } : values,
      });
  }
}
