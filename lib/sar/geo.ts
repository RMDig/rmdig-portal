import { type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db";

// SAR service-area geometry. The region lives in the PostGIS `region_geom`
// column (geography(Polygon,4326)) added by migration 0006 and is read/written
// only through this module — keeping every raw-SQL spatial expression in one
// place. Drizzle's pg-core has no geography type, so region_geom is absent from
// lib/db/schema.ts on purpose (see the note there). Coordinates are GeoJSON axis
// order: [longitude, latitude] in WGS84 (SRID 4326).

const MAX_VERTICES_PER_RING = 10_000; // guards against pathological client input
const MAX_RINGS = 50; // one exterior ring + a sane number of interior holes

// A GeoJSON position: [lon, lat]. The spec permits an optional third elevation
// value, which we accept and ignore; only lon/lat are range-checked.
const position = z
  .tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])
  .rest(z.number());

// A polygon linear ring: at least 4 positions and explicitly closed (the last
// position equals the first), per the GeoJSON spec.
const linearRing = z
  .array(position)
  .min(4)
  .max(MAX_VERTICES_PER_RING)
  .refine(
    (ring) => {
      const first = ring[0]!;
      const last = ring[ring.length - 1]!;
      return first[0] === last[0] && first[1] === last[1];
    },
    { message: "Polygon ring must be closed (last position equals the first)" },
  );

/**
 * GeoJSON Polygon as emitted by Terra Draw on the client. Validated at the
 * boundary (conventions §5) before it ever reaches PostGIS so a malformed ring
 * is a loud, specific error rather than a confusing ST_GeomFromGeoJSON failure
 * deep inside the org-creation transaction. Structural validity only —
 * self-intersection is caught server-side by ST_IsValid in {@link setRegionGeom}.
 */
export const RegionPolygonSchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(linearRing).min(1).max(MAX_RINGS),
});

export type RegionPolygon = z.infer<typeof RegionPolygonSchema>;

// Minimal structural type satisfied by both the module `db` and a transaction
// handle (`db.transaction(async (tx) => …)`), so spatial writes can run inside
// the org-creation transaction or standalone.
type SqlExecutor = { execute: (query: SQL) => Promise<unknown> };

/**
 * Write a validated polygon to an org's region_geom in a single statement that
 * also rejects geometrically-invalid polygons. ST_IsValid catches
 * self-intersecting or degenerate rings that pass JSON-schema validation but are
 * meaningless as a service area; a failure raises and aborts the surrounding
 * transaction. Pass the transaction handle as `exec` to keep the write atomic
 * with the org insert.
 */
export async function setRegionGeom(
  orgId: string,
  polygon: RegionPolygon,
  exec: SqlExecutor = db,
): Promise<void> {
  const json = JSON.stringify(polygon);
  const rows = (await exec.execute(sql`
    WITH candidate AS (
      SELECT ST_SetSRID(ST_GeomFromGeoJSON(${json}), 4326) AS geom
    )
    UPDATE sar_orgs
    SET region_geom = (SELECT geom FROM candidate)::geography
    WHERE id = ${orgId}
      AND (SELECT ST_IsValid(geom) FROM candidate)
    RETURNING id
  `)) as unknown as Array<{ id: string }>;

  if (rows.length === 0) {
    // No row updated means either the polygon failed ST_IsValid or the org id is
    // unknown. In the create flow the row was just inserted in this same
    // transaction, so an invalid polygon is the realistic cause — either way
    // it's a caller bug, surfaced loudly rather than silently leaving a null
    // region on a "submitted" org.
    throw new Error(
      `setRegionGeom: no row updated for org ${orgId} — polygon failed ST_IsValid or org not found`,
    );
  }
}

/**
 * Find every approved SAR org whose service area contains the given point. This
 * is the routing query AvServ alert dispatch will lean on (rmdig-ai
 * docs/plans/03): a user's last-known GPS resolves to all covering orgs. Uses
 * ST_Covers (closed — a point exactly on the boundary counts) on the geography
 * type for true spheroidal containment. Restricted to `approved` orgs so an
 * unverified org never enters routing.
 */
export async function findApprovedOrgsContaining(
  lon: number,
  lat: number,
  exec: SqlExecutor = db,
): Promise<Array<{ id: string; name: string }>> {
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
    throw new Error(`findApprovedOrgsContaining: coordinate out of range (${lon}, ${lat})`);
  }
  const rows = (await exec.execute(sql`
    SELECT id, name
    FROM sar_orgs
    WHERE status = 'approved'
      AND region_geom IS NOT NULL
      AND ST_Covers(region_geom, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography)
    ORDER BY name
  `)) as unknown as Array<{ id: string; name: string }>;
  return rows;
}

/**
 * Read an org's region back as a GeoJSON Polygon for the admin preview / map
 * re-hydration. Returns null when the org has no region set. The result is
 * re-validated through {@link RegionPolygonSchema} so a drifted DB value can't
 * render as malformed GeoJSON on the client.
 */
export async function getRegionAsGeoJson(
  orgId: string,
  exec: SqlExecutor = db,
): Promise<RegionPolygon | null> {
  const rows = (await exec.execute(sql`
    SELECT ST_AsGeoJSON(region_geom)::text AS geojson
    FROM sar_orgs
    WHERE id = ${orgId}
  `)) as unknown as Array<{ geojson: string | null }>;
  const raw = rows[0]?.geojson;
  if (!raw) return null;
  return RegionPolygonSchema.parse(JSON.parse(raw));
}
