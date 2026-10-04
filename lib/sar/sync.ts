import { and, desc, eq, sql } from "drizzle-orm";

import { avservNodes, putSarTeam } from "../avserv/sar-teams";
import { db } from "../db";
import { sarOrgs, sarOrgSync, sarOrgTerms } from "../db/schema";
import { logger } from "../logger";
import { RegionPolygonSchema } from "./geo";
import { planSync, type SkipReason } from "./sync-body";

// Send a SAR org's current state to every AvServ node (sar_team_sync.md).
// Called after each decision that changes what AvServ must know (approve,
// suspend, leaving, withdraw, re-verify, terms publish) and from the staff
// resync button. The decision itself is already committed: a node that fails
// is logged loudly, recorded per node and shown to staff, never rolled back
// into the decision. A failed node also converges from its peer by
// replication once the other node accepted the PUT.

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
    SELECT ST_AsGeoJSON(ST_SimplifyPreserveTopology(region_geom::geometry, 0.0005), 6)::text AS geojson
    FROM sar_orgs WHERE id = ${orgId}
  `)) as unknown as Array<{ geojson: string | null }>;
  const area = areaRow?.geojson ? RegionPolygonSchema.parse(JSON.parse(areaRow.geojson)).coordinates : null;

  const [terms] = await db
    .select()
    .from(sarOrgTerms)
    .where(and(eq(sarOrgTerms.orgId, orgId), eq(sarOrgTerms.status, "published")))
    .orderBy(desc(sarOrgTerms.version))
    .limit(1);

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
      return { node: n.name, outcome: "error", code: r.code };
    }),
  );
  await record(orgId, outcomes, body.revision, now);
  logger.info({ event: "sar.sync.sent", orgId, revision: body.revision, status: body.status, outcomes: outcomes.map((o) => `${o.node}:${o.outcome}`) });
  return outcomes;
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
