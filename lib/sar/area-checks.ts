import { type SQL, sql } from "drizzle-orm";

import { db } from "../db";
import { reportProblem } from "../report-error";
import { buildDeviceArea, deviceAreaRefusal } from "./device-area";
import { type RegionPolygon, RegionPolygonSchema, SYNC_DECIMALS, SYNC_SIMPLIFY_DEGREES } from "./geo";

// Server checks on a SAR team's service area before it's saved (plan 33 §6.3,
// step 9.3). They run on the shape the sync sends (simplified ~50 m, 6
// decimals; lib/sar/sync.ts), because that's what AvServ checks and matches
// against: an area that passes here is one every node accepts.
//
// 1. AvServ's caps first (internal/sargeo/sargeo.go, internal/api/sarteams.go):
//    over them, every node refuses the sync, so the save is refused, saying
//    how much to simplify. Then the device copy (lib/sar/device-area.ts): an
//    area whose phone copy is over its point cap is refused the same way.
// 2. Area in km² (ST_Area on geography), for the large-area warning (9.5).
// 3. Overlap with other live teams: a warning, never a refusal, naming them,
//    with a previewed clip, ST_Difference(area, ST_Union(theirs)). A clip
//    that leaves nothing or more than one piece can't be offered: the portal
//    stores and sends one Polygon.
//
// Drill teams (plan 37 §4.4) are left out of every overlap: a real team may
// cover a drill team's area, unrefused and unwarned, and never sees its name
// or shape. A drill team's own limits are in lib/sar/drill.ts.
//
// Overlap uses planar GEOMETRY predicates, like AvServ's matcher and the
// shared vectors (tests/integration/sar-area-vectors.test.ts). Teams that only
// share a border don't overlap.

/** AvServ's limits on one team's area (sargeo.go; sarteams.go maxSARAreaBytes). */
export const AVSERV_AREA_CAPS = {
  bytes: 1 << 20,
  verticesPerRing: 10_000,
  minVerticesPerRing: 4,
  verticesPerOrg: 100_000,
} as const;

/** The large-area warning's threshold (plan 33 O8): the land area of Las
 *  Animas County, Colorado's largest county. Census 2024 Gazetteer, GEOID
 *  08071, ALAND 12,361,852,647 m² (Moffat is next at 12,284,943,817). A soft
 *  warning only; a team may serve more. */
export const LARGE_AREA_KM2 = 12_361.852647;

/** The statuses whose areas AvServ may still match or bind (plan 33 §6.3 step 1). */
export const LIVE_ORG_STATUSES = ["pending", "approved", "suspended", "leaving"] as const;

export type CapsResult =
  | { ok: true; bytes: number; vertices: number }
  | { ok: false; code: "area_too_large" | "area_invalid"; message: string; bytes: number; vertices: number };

/** The bytes AvServ measures: the compact `serviceArea` JSON the sync body carries. */
export function serviceAreaBytes(area: RegionPolygon): number {
  return Buffer.byteLength(JSON.stringify({ type: "Polygon", coordinates: area.coordinates }), "utf8");
}

const percentToRemove = (have: number, limit: number) => Math.max(1, Math.ceil((1 - limit / have) * 100));
const n = (x: number) => new Intl.NumberFormat("en-US").format(x);

/** AvServ's caps on the area as it will be sent. A refusal says how much to simplify. */
export function checkAvservCaps(area: RegionPolygon): CapsResult {
  const rings = area.coordinates;
  const vertices = rings.reduce((sum, r) => sum + r.length, 0);
  const bytes = serviceAreaBytes(area);
  const fail = (code: "area_too_large" | "area_invalid", message: string): CapsResult => ({ ok: false, code, message, bytes, vertices });

  for (const [i, ring] of rings.entries()) {
    const which = i === 0 ? "The outline" : `Hole ${i}`;
    if (ring.length < AVSERV_AREA_CAPS.minVerticesPerRing) {
      return fail("area_invalid", `${which} is too small to keep once simplified to about 50 m. Draw it larger or remove it.`);
    }
    if (ring.length > AVSERV_AREA_CAPS.verticesPerRing) {
      return fail(
        "area_invalid",
        `${which} has ${n(ring.length)} points; the limit is ${n(AVSERV_AREA_CAPS.verticesPerRing)}. Remove about ${percentToRemove(ring.length, AVSERV_AREA_CAPS.verticesPerRing)}% of its points.`,
      );
    }
  }
  if (vertices > AVSERV_AREA_CAPS.verticesPerOrg) {
    return fail(
      "area_invalid",
      `The area has ${n(vertices)} points; the limit is ${n(AVSERV_AREA_CAPS.verticesPerOrg)}. Remove about ${percentToRemove(vertices, AVSERV_AREA_CAPS.verticesPerOrg)}% of its points.`,
    );
  }
  if (bytes > AVSERV_AREA_CAPS.bytes) {
    return fail(
      "area_too_large",
      `The area is ${(bytes / AVSERV_AREA_CAPS.bytes).toFixed(2)} MiB once simplified; the limit is 1 MiB. Remove about ${percentToRemove(bytes, AVSERV_AREA_CAPS.bytes)}% of its points.`,
    );
  }
  return { ok: true, bytes, vertices };
}

export interface OverlappingOrg {
  orgId: string;
  name: string;
  status: (typeof LIVE_ORG_STATUSES)[number];
  overlapKm2: number;
}

export type ClipPreview =
  | { ok: true; area: RegionPolygon; areaKm2: number; caps: CapsResult }
  | { ok: false; reason: "empty" | "multipart"; parts: number; message: string };

export type AreaAssessment =
  | { ok: false; code: "area_invalid" | "area_too_large"; message: string }
  | {
      ok: true;
      /** The area as the sync will send it. */
      area: RegionPolygon;
      areaKm2: number;
      bytes: number;
      vertices: number;
      overlaps: OverlappingOrg[];
      /** Only when something overlaps. */
      clip: ClipPreview | null;
    };

type SqlExecutor = { execute: (query: SQL) => Promise<unknown> };

// The shape the sync sends: simplified, rounded to SYNC_DECIMALS and parsed
// back, so every check sees the coordinates AvServ will.
const synced = (geom: SQL) =>
  sql`ST_SetSRID(ST_GeomFromGeoJSON(ST_AsGeoJSON(ST_SimplifyPreserveTopology(${geom}, ${SYNC_SIMPLIFY_DEGREES}), ${SYNC_DECIMALS}::int)), 4326)`;

/**
 * Check an area before saving it for `orgId` (null for a new application, so
 * no org is excluded from the overlap). Read-only.
 */
export async function assessArea(polygon: RegionPolygon, orgId: string | null, exec: SqlExecutor = db): Promise<AreaAssessment> {
  const input = sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(polygon)}), 4326)`;
  const [shape] = (await exec.execute(sql`
    WITH i AS (SELECT ${input} AS g)
    SELECT ST_IsValid(i.g) AS valid,
           ST_IsValidReason(i.g) AS reason,
           -- Simplifying an invalid shape can raise, so only a valid one is.
           CASE WHEN ST_IsValid(i.g) THEN ST_AsGeoJSON(${synced(sql`i.g`)}, ${SYNC_DECIMALS}::int)::text END AS geojson
    FROM i
  `)) as unknown as Array<{ valid: boolean; reason: string; geojson: string | null }>;
  if (!shape?.valid) {
    return { ok: false, code: "area_invalid", message: `The area isn't a valid shape (${shape?.reason ?? "unknown"}). Check that its edges don't cross.` };
  }
  const parsed = shape.geojson ? RegionPolygonSchema.safeParse(JSON.parse(shape.geojson)) : null;
  if (!parsed?.success) {
    return { ok: false, code: "area_invalid", message: "Simplified to about 50 m, the area is no longer one polygon. Draw it larger." };
  }
  const area = parsed.data;
  const caps = checkAvservCaps(area);
  if (!caps.ok) return { ok: false, code: caps.code, message: caps.message };
  const device = await buildDeviceArea(area, exec);
  const deviceRefusal = deviceAreaRefusal(device);
  if (deviceRefusal) {
    // A copy that doesn't cover the area, or has no shape, is the portal's
    // fault, not the team's: refused all the same, and loud.
    if (!device.ok && device.reason !== "too_many_points") {
      reportProblem("sar.area.device_copy_failed", "A team's area couldn't be given a phone copy that covers it", { orgId, reason: device.reason, points: device.points ?? "none" });
    }
    return { ok: false, code: "area_invalid", message: deviceRefusal };
  }

  const sent = sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(area)}), 4326)`;
  const others = sql`
    SELECT o.id, o.name, o.status, ${synced(sql`o.region_geom::geometry`)} AS g
    FROM sar_orgs o
    WHERE o.region_geom IS NOT NULL
      AND NOT o.is_drill
      AND o.status::text IN (${sql.join(LIVE_ORG_STATUSES.map((s) => sql`${s}`), sql`, `)})
      ${orgId ? sql`AND o.id <> ${orgId}` : sql``}
  `;
  const rows = (await exec.execute(sql`
    WITH a AS (SELECT ${sent} AS g),
         o AS (${others})
    SELECT o.id, o.name, o.status,
           ST_Area(ST_Intersection(a.g, o.g)::geography) / 1e6 AS overlap_km2,
           ST_Area(a.g::geography) / 1e6 AS area_km2
    FROM a LEFT JOIN o ON ST_Intersects(a.g, o.g) AND NOT ST_Touches(a.g, o.g)
    ORDER BY o.name
  `)) as unknown as Array<{ id: string | null; name: string; status: OverlappingOrg["status"]; overlap_km2: number; area_km2: number }>;

  const areaKm2 = Number(rows[0]?.area_km2 ?? 0);
  const overlaps = rows
    .filter((r): r is typeof r & { id: string } => r.id !== null)
    .map((r) => ({ orgId: r.id, name: r.name, status: r.status, overlapKm2: Number(r.overlap_km2) }));
  if (overlaps.length === 0) return { ok: true, area, areaKm2, bytes: caps.bytes, vertices: caps.vertices, overlaps, clip: null };

  const ids = overlaps.map((o) => o.orgId);
  const [cut] = (await exec.execute(sql`
    WITH a AS (SELECT ${sent} AS g),
         o AS (SELECT ST_Union(${synced(sql`region_geom::geometry`)}) AS g FROM sar_orgs
               WHERE id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})),
         d AS (SELECT ST_Difference(a.g, o.g) AS g FROM a, o)
    SELECT ST_IsEmpty(d.g) AS empty,
           ST_NumGeometries(ST_CollectionExtract(d.g, 3)) AS parts,
           -- One piece can still come back typed MultiPolygon: send its polygon.
           ST_AsGeoJSON(ST_GeometryN(ST_CollectionExtract(d.g, 3), 1), ${SYNC_DECIMALS}::int)::text AS geojson,
           ST_Area(d.g::geography) / 1e6 AS km2
    FROM d
  `)) as unknown as Array<{ empty: boolean; parts: number; geojson: string | null; km2: number }>;

  return { ok: true, area, areaKm2, bytes: caps.bytes, vertices: caps.vertices, overlaps, clip: clipPreview(cut) };
}

function clipPreview(cut: { empty: boolean; parts: number; geojson: string | null; km2: number } | undefined): ClipPreview {
  if (!cut || cut.empty || Number(cut.parts) === 0) {
    return { ok: false, reason: "empty", parts: 0, message: "Removing the other teams' areas would leave nothing of this one." };
  }
  const parts = Number(cut.parts);
  const clipped = RegionPolygonSchema.safeParse(cut.geojson ? JSON.parse(cut.geojson) : null);
  if (parts > 1 || !clipped.success) {
    return {
      ok: false,
      reason: "multipart",
      parts,
      message: `Removing the other teams' areas would split this one into ${parts} pieces. A team's area must be one shape, so adjust it by hand.`,
    };
  }
  return { ok: true, area: clipped.data, areaKm2: Number(cut.km2), caps: checkAvservCaps(clipped.data) };
}
