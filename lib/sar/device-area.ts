import { type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db";
import { type RegionPolygon, RegionPolygonSchema, SYNC_DECIMALS } from "./geo";

// The device copy of a team's area (AvApp plan 68; sar_team_sync.md revision
// 4, field `deviceServiceArea`): what a user's phone holds once the user has
// accepted the team's terms, to tell when the user leaves the area. It's
// built from the area as the sync sends it (`serviceArea`, lib/sar/sync.ts),
// because that's the shape AvServ treats as the team's area.
//
// The copy must COVER the area: a simplified edge may never move a spot inside
// the area to outside the copy, so "outside the copy" always means "outside
// the area". The area is grown by DEVICE_AREA_BUFFER_METERS, then simplified
// at DEVICE_AREA_TOLERANCE_METERS. Simplifying moves an edge by at most the
// tolerance, and the extra metre covers rounding to SYNC_DECIMALS (about
// 0.1 m) and reprojection. The copy is never trusted on that argument: each
// one is checked with ST_Covers, after rounding, before it's used.
//
// The work happens in metres, in the UTM zone of the area's centroid.
// Simplifying in degrees would stretch the tolerance east to west.
//
// The phone can then conclude: outside the copy, certainly outside the area;
// inside it and more than bufferMeters + toleranceMeters from its edge,
// certainly inside; in between, unknown. A hole narrower than about twice the
// buffer disappears from the copy, so near one the phone reads "inside".

export const DEVICE_AREA_TOLERANCE_METERS = 50;
export const DEVICE_AREA_BUFFER_METERS = 51;
/** AvServ's proposed cap on the copy (AvApp plan 68), counted with
 *  ST_NPoints: every ring's points, its closing point included. */
export const DEVICE_AREA_MAX_POINTS = 5_000;

const polygonCoordinates = RegionPolygonSchema.shape.coordinates;

/** The copy's geometry: one Polygon today (the portal stores one), but a
 *  MultiPolygon is valid on the wire, so a future multi-part area needs no
 *  new revision. */
export const DeviceAreaGeometrySchema = z.discriminatedUnion("type", [
  RegionPolygonSchema,
  z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(polygonCoordinates).min(1) }),
]);
export type DeviceAreaGeometry = z.infer<typeof DeviceAreaGeometrySchema>;

/** The sync body's `deviceServiceArea` (revision 4). */
export interface DeviceServiceArea {
  geometry: DeviceAreaGeometry;
  toleranceMeters: typeof DEVICE_AREA_TOLERANCE_METERS;
  bufferMeters: typeof DEVICE_AREA_BUFFER_METERS;
}

export type DeviceAreaResult =
  | { ok: true; deviceArea: DeviceServiceArea; points: number }
  | { ok: false; reason: "too_many_points"; points: number }
  | { ok: false; reason: "not_covering" | "no_shape"; points: number | null };

type SqlExecutor = { execute: (query: SQL) => Promise<unknown> };

// The UTM zone of a point's longitude, north or south: EPSG 326xx / 327xx.
const utmSrid = (g: SQL) =>
  sql`(CASE WHEN ST_Y(ST_Centroid(${g})) < 0 THEN 32700 ELSE 32600 END + floor((ST_X(ST_Centroid(${g})) + 180) / 6)::int % 60 + 1)`;

/**
 * Build and check the device copy of `area`, the area exactly as the sync
 * sends it. Read-only.
 */
export async function buildDeviceArea(area: RegionPolygon, exec: SqlExecutor = db): Promise<DeviceAreaResult> {
  const sent = sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(area)}), 4326)`;
  const [row] = (await exec.execute(sql`
    WITH a AS (SELECT ${sent} AS g),
         z AS (SELECT a.g, ${utmSrid(sql`a.g`)} AS srid FROM a),
         -- Grown, simplified, made valid and kept to polygons, in metres.
         m AS (
           SELECT z.g AS area,
                  ST_CollectionExtract(ST_MakeValid(ST_SimplifyPreserveTopology(
                    ST_Buffer(ST_Transform(z.g, z.srid), ${DEVICE_AREA_BUFFER_METERS}, 'join=mitre mitre_limit=2'),
                    ${DEVICE_AREA_TOLERANCE_METERS})), 3) AS g,
                  z.srid
           FROM z
         ),
         -- Back to WGS 84, rounded exactly as sent, and parsed back, so the
         -- check sees the coordinates the phone will.
         d AS (
           SELECT m.area,
                  CASE WHEN NOT ST_IsEmpty(m.g)
                    THEN ST_SetSRID(ST_GeomFromGeoJSON(ST_AsGeoJSON(ST_Transform(m.g, 4326), ${SYNC_DECIMALS}::int)), 4326)
                  END AS g
           FROM m
         )
    SELECT ST_AsGeoJSON(d.g, ${SYNC_DECIMALS}::int)::text AS geojson,
           ST_NPoints(d.g) AS points,
           COALESCE(ST_Covers(d.g, d.area), false) AS covers
    FROM d
  `)) as unknown as Array<{ geojson: string | null; points: number | null; covers: boolean }>;

  const points = row?.points === null || row?.points === undefined ? null : Number(row.points);
  if (!row?.geojson || points === null) return { ok: false, reason: "no_shape", points };
  // The cap first: a copy far over it can also be over the schema's ring
  // limit, and the team needs the count to know how much to simplify.
  if (points > DEVICE_AREA_MAX_POINTS) return { ok: false, reason: "too_many_points", points };
  const parsed = DeviceAreaGeometrySchema.safeParse(JSON.parse(row.geojson));
  if (!parsed.success) return { ok: false, reason: "no_shape", points };
  if (!row.covers) return { ok: false, reason: "not_covering", points };
  return {
    ok: true,
    points,
    deviceArea: { geometry: parsed.data, toleranceMeters: DEVICE_AREA_TOLERANCE_METERS, bufferMeters: DEVICE_AREA_BUFFER_METERS },
  };
}

const n = (x: number) => new Intl.NumberFormat("en-US").format(x);

/** Why an area can't be saved, for the team, or null when its device copy is
 *  fine. A copy that doesn't cover the area, or has no shape, is a portal
 *  bug, not the team's: the caller logs it. */
export function deviceAreaRefusal(result: DeviceAreaResult): string | null {
  if (result.ok) return null;
  if (result.reason === "too_many_points") {
    const remove = Math.max(1, Math.ceil((1 - DEVICE_AREA_MAX_POINTS / result.points) * 100));
    return `On phones the area needs ${n(result.points)} points; the limit is ${n(DEVICE_AREA_MAX_POINTS)}. Remove about ${remove}% of its points, or smooth its edges.`;
  }
  return "The area couldn't be prepared for phones. Try again, and if it happens again, contact rmdig support.";
}
