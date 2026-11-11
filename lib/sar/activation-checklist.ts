import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "../db";
import { orgMemberships, sarOrgs, sarOrgTerms } from "../db/schema";
import type { ActivationFacts } from "./activation-checklist-rules";
import { LARGE_AREA_KM2 } from "./area-checks";
import { testAlertFact } from "./test-alert";

// The facts behind a real team's activation checklist (plan 33 §6.9 G2;
// rules in lib/sar/activation-checklist-rules.ts).

/** The checks the portal can make itself, read fresh at Approve. */
export async function activationFacts(orgId: string): Promise<ActivationFacts> {
  const [org] = await db.select({ oncallEmailVerifiedAt: sarOrgs.oncallEmailVerifiedAt }).from(sarOrgs).where(eq(sarOrgs.id, orgId)).limit(1);
  const members = await db.select({ role: orgMemberships.role }).from(orgMemberships).where(eq(orgMemberships.orgId, orgId));
  const [terms] = await db
    .select({ version: sarOrgTerms.version })
    .from(sarOrgTerms)
    .where(and(eq(sarOrgTerms.orgId, orgId), eq(sarOrgTerms.status, "published")))
    .orderBy(desc(sarOrgTerms.version))
    .limit(1);
  const [area] = (await db.execute(sql`
    SELECT ST_Area(region_geom) / 1e6 AS km2 FROM sar_orgs WHERE id = ${orgId}
  `)) as unknown as Array<{ km2: number | null }>;
  const areaKm2 = area?.km2 == null ? null : Number(area.km2);
  return {
    oncallEmailVerified: !!org?.oncallEmailVerifiedAt,
    members: members.length,
    admins: members.filter((m) => m.role === "admin").length,
    publishedTermsVersion: terms?.version ?? null,
    areaKm2,
    largeArea: areaKm2 !== null && areaKm2 > LARGE_AREA_KM2,
    testAlert: await testAlertFact(orgId, new Date()),
  };
}

