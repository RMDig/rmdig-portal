import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "../db";
import { orgMemberships, sarOrgTerms } from "../db/schema";
import type { ActivationFacts } from "./activation-checklist-rules";
import { LARGE_AREA_KM2 } from "./area-checks";
import { latestTestAlerts, testAlertFact, type TestAlertRow } from "./test-alert";

// The facts behind a real team's activation checklist (plan 33 §6.9 G2;
// rules in lib/sar/activation-checklist-rules.ts).

export interface ActivationView {
  facts: ActivationFacts;
  /** The latest test's rows, which the approvals row shows per node. */
  testAlert: TestAlertRow[];
}

/** The checks the portal can make itself, for any number of teams in a fixed
 *  number of queries (the approvals queue reads every pending team on one
 *  connection, lib/db). A team id that doesn't exist is absent. */
export async function activationViews(orgIds: string[], now: Date): Promise<Map<string, ActivationView>> {
  const out = new Map<string, ActivationView>();
  if (orgIds.length === 0) return out;
  const ids = sql.join(orgIds.map((id) => sql`${id}::uuid`), sql`, `);
  const orgs = (await db.execute(sql`
    SELECT id, oncall_email_verified_at IS NOT NULL AS verified, ST_Area(region_geom) / 1e6 AS km2
    FROM sar_orgs WHERE id IN (${ids})
  `)) as unknown as Array<{ id: string; verified: boolean; km2: number | string | null }>;
  const members = await db
    .select({ orgId: orgMemberships.orgId, role: orgMemberships.role })
    .from(orgMemberships)
    .where(inArray(orgMemberships.orgId, orgIds));
  const terms = await db
    .select({ orgId: sarOrgTerms.orgId, version: sql<number>`max(${sarOrgTerms.version})` })
    .from(sarOrgTerms)
    .where(and(inArray(sarOrgTerms.orgId, orgIds), eq(sarOrgTerms.status, "published")))
    .groupBy(sarOrgTerms.orgId);
  const tests = await latestTestAlerts(orgIds);

  for (const o of orgs) {
    const mine = members.filter((m) => m.orgId === o.id);
    const areaKm2 = o.km2 == null ? null : Number(o.km2);
    const version = terms.find((t) => t.orgId === o.id)?.version;
    const testAlert = tests.get(o.id) ?? [];
    out.set(o.id, {
      facts: {
        oncallEmailVerified: o.verified,
        members: mine.length,
        admins: mine.filter((m) => m.role === "admin").length,
        publishedTermsVersion: version == null ? null : Number(version),
        areaKm2,
        largeArea: areaKm2 !== null && areaKm2 > LARGE_AREA_KM2,
        testAlert: testAlertFact(testAlert, now),
      },
      testAlert,
    });
  }
  return out;
}

/** One team's facts, read fresh at Approve. */
export async function activationFacts(orgId: string): Promise<ActivationFacts> {
  const view = (await activationViews([orgId], new Date())).get(orgId);
  if (!view) throw new Error(`activationFacts: no SAR org ${orgId}`);
  return view.facts;
}
