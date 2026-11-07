import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { RegionPolygon } from "@/lib/sar/geo";

type Ring = RegionPolygon["coordinates"][number];

// Area checks before a SAR team's area is saved (plan 33 §6.3, step 9.3):
// AvServ's caps on the shape the sync sends (up to and over 1 MiB), the area
// in km², overlap with other live teams, and the clip preview.
//
// Runs every migration into a fresh, throwaway database on the local server
// and drops it afterwards. Run:
// INTEGRATION_DATABASE_URL=postgresql://postgres:pw@127.0.0.1:55432/postgres pnpm test:integration

const url = process.env.INTEGRATION_DATABASE_URL;
if (!url) throw new Error("Set INTEGRATION_DATABASE_URL to a local PostGIS database.");
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") {
  throw new Error(`Refusing non-local INTEGRATION_DATABASE_URL host ${host}: integration tests never touch Neon.`);
}

const dbName = `area_it_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const admin = postgres(url, { max: 1, onnotice: () => {} });
const testUrl = Object.assign(new URL(url), { pathname: `/${dbName}` }).toString();
let sql: postgres.Sql;
let exec: ReturnType<typeof drizzle>;
let checks: typeof import("@/lib/sar/area-checks");
let userId: string;

type Status = "pending" | "approved" | "rejected" | "suspended" | "leaving" | "withdrawn";

/** A rectangle [west, south, east, north] as a closed GeoJSON Polygon. */
const rect = (w: number, s: number, e: number, n: number): RegionPolygon => ({
  type: "Polygon",
  coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
});

/** A closed star ring of `count` positions whose points alternate between two
 *  radii, so simplifying to ~50 m keeps every one. Rounded to 6 decimals, as
 *  the sync sends it. */
function star(cx: number, cy: number, r: number, spike: number, count: number): Ring {
  const round = (x: number) => Math.round(x * 1e6) / 1e6;
  const ring: Ring = [];
  for (let i = 0; i < count - 1; i++) {
    const a = (2 * Math.PI * i) / (count - 1);
    const rr = i % 2 ? r + spike : r;
    ring.push([round(cx + rr * Math.cos(a)), round(cy + rr * Math.sin(a))]);
  }
  ring.push(ring[0]!);
  return ring;
}

/** An outline of 10,000 points with `holes` holes of 10,000 points each, far
 *  from every other test area. */
function heavy(holes: number): RegionPolygon {
  const coordinates = [star(-110, 45, 1, 0.05, 10_000)];
  for (let h = 0; h < holes; h++) {
    const a = (2 * Math.PI * h) / 5;
    coordinates.push(star(-110 + 0.5 * Math.cos(a), 45 + 0.5 * Math.sin(a), 0.1, 0.005, 10_000));
  }
  return { type: "Polygon", coordinates };
}

async function org(name: string, status: Status, area: RegionPolygon): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO sar_orgs (name, contact_name, contact_email, operating_status, proof_doc_url, created_by_user_id, status, region_geom)
    VALUES (${name}, 'Lead', 'lead@sar.org', 'county_sar', 'blob://proof', ${userId}, ${status},
            ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(area)}), 4326)::geography)
    RETURNING id`;
  return row!.id;
}

// Region 1 (around -106, 39): the team's own area, half overlapped by B.
const AREA_1 = rect(-106, 39, -105.8, 39.2);
let ownId: string;
let bId: string;

beforeAll(async () => {
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  sql = postgres(testUrl, { max: 2, onnotice: () => {} });
  await migrate(drizzle(sql), { migrationsFolder: "lib/db/migrations" });
  const [user] = await sql<{ id: string }[]>`INSERT INTO users (email) VALUES ('lead@sar.org') RETURNING id`;
  userId = user!.id;

  ownId = await org("Own team", "approved", AREA_1);
  bId = await org("Bravo SAR", "approved", rect(-105.9, 39, -105.7, 39.2));
  await org("Charlie SAR (rejected)", "rejected", AREA_1);
  await org("Delta SAR (withdrawn)", "withdrawn", AREA_1);
  await org("Echo SAR (next door)", "pending", rect(-106.2, 39, -106, 39.2));
  // Region 2 (around -104, 38.5): a strip across the middle of the area.
  await org("Foxtrot SAR", "suspended", rect(-103.95, 38, -103.9, 39));

  process.env.DATABASE_URL = testUrl;
  checks = await import("@/lib/sar/area-checks");
  exec = drizzle(sql);
}, 60_000);

afterAll(async () => {
  await sql?.end();
  // lib/db holds its own connection; force it off so the drop succeeds.
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe("SAR area checks (PostGIS)", () => {
  it("measures the area in km² on the shape the sync sends", async () => {
    const r = await checks.assessArea(rect(-104, 36, -103.9, 36.1), null, exec);
    if (!r.ok) throw new Error(r.message);
    // 0.1° × 0.1° at 36°N: about 11.1 km × 9.0 km.
    expect(r.areaKm2).toBeGreaterThan(98);
    expect(r.areaKm2).toBeLessThan(102);
    expect(r.overlaps).toEqual([]);
    expect(r.clip).toBeNull();
  });

  it("returns exactly what the sync would send for the same area", async () => {
    const polygon = heavy(1);
    const id = await org("Sync twin", "withdrawn", polygon);
    const [sent] = await sql<{ geojson: string }[]>`
      SELECT ST_AsGeoJSON(ST_SimplifyPreserveTopology(region_geom::geometry, 0.0005), 6)::text AS geojson
      FROM sar_orgs WHERE id = ${id}`;
    const r = await checks.assessArea(polygon, null, exec);
    if (!r.ok) throw new Error(r.message);
    expect(r.area).toEqual(JSON.parse(sent!.geojson));
    expect(r.bytes).toBe(Buffer.byteLength(JSON.stringify({ type: "Polygon", coordinates: r.area.coordinates })));
  });

  it("names live teams that overlap, but not rejected, withdrawn, bordering or its own", async () => {
    const r = await checks.assessArea(AREA_1, ownId, exec);
    if (!r.ok) throw new Error(r.message);
    expect(r.overlaps.map((o) => o.name)).toEqual(["Bravo SAR"]);
    expect(r.overlaps[0]).toMatchObject({ orgId: bId, status: "approved" });
    // Half of a ~380 km² area.
    expect(r.overlaps[0]!.overlapKm2).toBeGreaterThan(r.areaKm2 * 0.49);
    expect(r.overlaps[0]!.overlapKm2).toBeLessThan(r.areaKm2 * 0.51);
  });

  it("counts its own org as another team for a new application", async () => {
    const r = await checks.assessArea(AREA_1, null, exec);
    if (!r.ok) throw new Error(r.message);
    expect(r.overlaps.map((o) => o.name)).toEqual(["Bravo SAR", "Own team"]);
  });

  it("previews the clip as one polygon without the other team's part", async () => {
    const r = await checks.assessArea(AREA_1, ownId, exec);
    if (!r.ok || !r.clip?.ok) throw new Error("expected a clip");
    expect(r.clip.area.type).toBe("Polygon");
    expect(r.clip.areaKm2).toBeGreaterThan(r.areaKm2 * 0.49);
    expect(r.clip.areaKm2).toBeLessThan(r.areaKm2 * 0.51);
    const xs = r.clip.area.coordinates[0]!.map((p) => p[0]!);
    expect(Math.max(...xs)).toBeCloseTo(-105.9, 6);
    expect(r.clip.caps.ok).toBe(true);
  });

  it("refuses a clip that would leave nothing", async () => {
    const r = await checks.assessArea(rect(-105.85, 39.05, -105.75, 39.15), ownId, exec);
    if (!r.ok) throw new Error(r.message);
    expect(r.overlaps.map((o) => o.name)).toEqual(["Bravo SAR"]);
    expect(r.clip).toMatchObject({ ok: false, reason: "empty" });
  });

  it("refuses a clip that would split the area into pieces", async () => {
    const r = await checks.assessArea(rect(-104, 38.4, -103.8, 38.6), null, exec);
    if (!r.ok) throw new Error(r.message);
    expect(r.overlaps).toEqual([expect.objectContaining({ name: "Foxtrot SAR", status: "suspended" })]);
    expect(r.clip).toMatchObject({ ok: false, reason: "multipart", parts: 2 });
  });

  it("refuses a shape whose edges cross", async () => {
    const bowtie: RegionPolygon = { type: "Polygon", coordinates: [[[-104, 37], [-103.9, 37.1], [-103.9, 37], [-104, 37.1], [-104, 37]]] };
    expect(await checks.assessArea(bowtie, null, exec)).toMatchObject({ ok: false, code: "area_invalid", message: expect.stringMatching(/edges/) });
  });

  it("accepts an area just under 1 MiB as sent, and refuses one over it, saying how much to simplify", async () => {
    const under = await checks.assessArea(heavy(3), null, exec);
    if (!under.ok) throw new Error(under.message);
    // Simplifying drops a few points where a hole's spikes are densest.
    expect(under.vertices).toBeGreaterThan(38_000);
    expect(under.bytes).toBeGreaterThan(0.8 * 2 ** 20);
    expect(under.bytes).toBeLessThanOrEqual(2 ** 20);

    const over = await checks.assessArea(heavy(4), null, exec);
    expect(over).toMatchObject({ ok: false, code: "area_too_large", message: expect.stringMatching(/MiB once simplified; the limit is 1 MiB\. Remove about \d+% of its points/) });
  }, 30_000);
});
