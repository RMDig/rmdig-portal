import { eq, inArray, sql } from "drizzle-orm";

import { columnsToAdTarget } from "../advertiser/target";
import { db } from "../db";
import { adCampaigns, adCreatives, advertiserMemberships } from "../db/schema";
import { describeTarget } from "../geo/lookup";
import { RegionPolygonSchema } from "../sar/geo";
import type { OrgRow, OrgStatus, TargetRow } from "./layers";

// Reads for /map (server components only), each scoped to the viewer. One query per layer
// (no per-org round trips); polygons come back simplified (about 50 m) and at
// 5-decimal precision, plenty for an overview and far smaller to send.

type GeoRow = { id: string; name: string; status: OrgStatus; geojson: string | null };

function toOrgRows(rows: GeoRow[]): OrgRow[] {
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    // Re-validated so a drifted DB value fails loudly instead of drawing garbage.
    coordinates: r.geojson ? RegionPolygonSchema.parse(JSON.parse(r.geojson)).coordinates : null,
  }));
}

const SIMPLIFIED = sql`ST_AsGeoJSON(ST_SimplifyPreserveTopology(o.region_geom::geometry, 0.0005), 5)::text`;

/** The SAR orgs the user belongs to, any status. */
export async function memberOrgRows(userId: string): Promise<OrgRow[]> {
  const rows = (await db.execute(sql`
    SELECT o.id, o.name, o.status, ${SIMPLIFIED} AS geojson
    FROM sar_orgs o
    JOIN org_memberships m ON m.org_id = o.id
    WHERE m.user_id = ${userId}
    ORDER BY o.name
  `)) as unknown as GeoRow[];
  return toOrgRows(rows);
}

/** Every org except rejected ones. Staff only: the caller checks the role. */
export async function allOrgRows(): Promise<OrgRow[]> {
  const rows = (await db.execute(sql`
    SELECT o.id, o.name, o.status, ${SIMPLIFIED} AS geojson
    FROM sar_orgs o
    WHERE o.status <> 'rejected'
    ORDER BY o.name
  `)) as unknown as GeoRow[];
  return toOrgRows(rows);
}

/** The advertiser accounts the user belongs to. */
export async function advertiserIdsFor(userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: advertiserMemberships.advertiserId })
    .from(advertiserMemberships)
    .where(eq(advertiserMemberships.userId, userId));
  return rows.map((r) => r.id);
}

/** Creatives of those advertiser accounts, with their targets. */
export async function targetRows(advertiserIds: string[]): Promise<TargetRow[]> {
  if (advertiserIds.length === 0) return [];
  const rows = await db
    .select({
      id: adCreatives.id,
      headline: adCreatives.headline,
      status: adCreatives.status,
      targetKind: adCreatives.targetKind,
      targetLat: adCreatives.targetLat,
      targetLon: adCreatives.targetLon,
      targetRadiusMi: adCreatives.targetRadiusMi,
      targetAdminLevel: adCreatives.targetAdminLevel,
      targetAdminFips: adCreatives.targetAdminFips,
    })
    .from(adCreatives)
    .innerJoin(adCampaigns, eq(adCampaigns.id, adCreatives.campaignId))
    .where(inArray(adCampaigns.advertiserId, advertiserIds))
    .limit(200);
  return rows.map((r) => {
    const t = columnsToAdTarget(r);
    return {
      id: r.id,
      headline: r.headline,
      status: r.status,
      description: describeTarget(r),
      radius: t.kind === "radius" ? { lat: t.lat, lon: t.lon, mi: t.mi } : null,
    };
  });
}
