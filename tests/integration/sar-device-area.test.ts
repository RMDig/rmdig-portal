import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DeviceAreaGeometry } from "@/lib/sar/device-area";
import type { RegionPolygon } from "@/lib/sar/geo";

// The device copy of a team's area (AvApp plan 68; lib/sar/device-area.ts):
// it covers the area as sent, stays within the buffer plus the tolerance of
// it, keeps to the point cap, and is the same bytes every time.
//
// Needs only PostGIS, no migrations: a fresh, throwaway database on the local
// server, dropped afterwards. Run:
// INTEGRATION_DATABASE_URL=postgresql://postgres:pw@127.0.0.1:55432/postgres pnpm test:integration

const url = process.env.INTEGRATION_DATABASE_URL;
if (!url) throw new Error("Set INTEGRATION_DATABASE_URL to a local PostGIS database.");
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") {
  throw new Error(`Refusing non-local INTEGRATION_DATABASE_URL host ${host}: integration tests never touch Neon.`);
}

const dbName = `device_it_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const admin = postgres(url, { max: 1, onnotice: () => {} });
const testUrl = Object.assign(new URL(url), { pathname: `/${dbName}` }).toString();
let sql: postgres.Sql;
let exec: ReturnType<typeof drizzle>;
let device: typeof import("@/lib/sar/device-area");

const round = (x: number) => Math.round(x * 1e6) / 1e6;

/** A rectangle [west, south, east, north] as a closed GeoJSON Polygon. */
const rect = (w: number, s: number, e: number, n: number): RegionPolygon => ({
  type: "Polygon",
  coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
});

/** A closed ring of `count` positions around (cx, cy), radius r degrees, with
 *  every other point pushed out by `spike` degrees. */
function star(cx: number, cy: number, r: number, spike: number, count: number): RegionPolygon["coordinates"][number] {
  const ring: RegionPolygon["coordinates"][number] = [];
  for (let i = 0; i < count - 1; i++) {
    const a = (2 * Math.PI * i) / (count - 1);
    const rr = i % 2 ? r + spike : r;
    ring.push([round(cx + rr * Math.cos(a)), round(cy + rr * Math.sin(a))]);
  }
  ring.push(ring[0]!);
  return ring;
}

/** How far (metres) the copy's edge reaches beyond the area at most: the
 *  Hausdorff distance between their boundaries, on the geography. */
async function outwardMeters(area: RegionPolygon, copy: DeviceAreaGeometry): Promise<number> {
  const [row] = await sql<{ m: number }[]>`
    WITH a AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(area)}), 4326) AS g),
         d AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(copy)}), 4326) AS g)
    SELECT ST_HausdorffDistance(ST_Transform(ST_Boundary(a.g), 32613), ST_Transform(ST_Boundary(d.g), 32613)) AS m FROM a, d`;
  return Number(row!.m);
}

async function covers(area: RegionPolygon, copy: DeviceAreaGeometry): Promise<boolean> {
  const [row] = await sql<{ c: boolean }[]>`
    SELECT ST_Covers(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(copy)}), 4326),
                     ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(area)}), 4326)) AS c`;
  return row!.c;
}

beforeAll(async () => {
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  sql = postgres(testUrl, { max: 2, onnotice: () => {} });
  await sql`CREATE EXTENSION IF NOT EXISTS postgis`;
  process.env.DATABASE_URL = testUrl;
  device = await import("@/lib/sar/device-area");
  exec = drizzle(sql);
}, 60_000);

afterAll(async () => {
  await sql?.end();
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe("the device copy of a team's area (PostGIS)", () => {
  it("covers a simple area, within the buffer plus the tolerance of its edge", async () => {
    const area = rect(-106, 39, -105.8, 39.2);
    const r = await device.buildDeviceArea(area, exec);
    if (!r.ok) throw new Error(r.reason);
    expect(r.deviceArea).toMatchObject({ toleranceMeters: 50, bufferMeters: 51 });
    expect(r.deviceArea.geometry.type).toBe("Polygon");
    expect(await covers(area, r.deviceArea.geometry)).toBe(true);
    // Mitre corners reach a little past the buffer; never past buffer + tolerance + corner allowance.
    expect(await outwardMeters(area, r.deviceArea.geometry)).toBeLessThan(51 * Math.SQRT2 + 50);
  });

  it("covers a jagged area whose small notches simplifying would cut across", async () => {
    // 2,000 points, notches ~30 m deep: simplified alone, an edge would cut inside them.
    const area: RegionPolygon = { type: "Polygon", coordinates: [star(-107, 38.5, 0.05, 0.0003, 2_000)] };
    const r = await device.buildDeviceArea(area, exec);
    if (!r.ok) throw new Error(r.reason);
    expect(await covers(area, r.deviceArea.geometry)).toBe(true);
    expect(r.points).toBeLessThan(2_000);
  });

  it("covers an area with a hole, and fills a hole narrower than the buffer", async () => {
    const outer = rect(-105, 38, -104.9, 38.1).coordinates[0]!;
    const wide = rect(-104.97, 38.03, -104.93, 38.07).coordinates[0]!.slice().reverse();
    const narrow = rect(-104.92, 38.02, -104.9195, 38.08).coordinates[0]!.slice().reverse(); // ~45 m wide
    const area: RegionPolygon = { type: "Polygon", coordinates: [outer, wide, narrow] };
    const r = await device.buildDeviceArea(area, exec);
    if (!r.ok) throw new Error(r.reason);
    expect(await covers(area, r.deviceArea.geometry)).toBe(true);
    expect(r.deviceArea.geometry.type === "Polygon" && r.deviceArea.geometry.coordinates.length).toBe(2);
  });

  it("works in the southern and eastern hemispheres (its own UTM zone)", async () => {
    const area = rect(147.1, -42.9, 147.3, -42.7);
    const r = await device.buildDeviceArea(area, exec);
    if (!r.ok) throw new Error(r.reason);
    expect(await covers(area, r.deviceArea.geometry)).toBe(true);
  });

  it("rounds to the sync's 6 decimals, and gives the same bytes every time", async () => {
    const area = rect(-106, 39, -105.8, 39.2);
    const a = await device.buildDeviceArea(area, exec);
    const b = await device.buildDeviceArea(area, exec);
    if (!a.ok || !b.ok) throw new Error("expected a copy");
    expect(JSON.stringify(a.deviceArea)).toBe(JSON.stringify(b.deviceArea));
    const coords = JSON.stringify(a.deviceArea.geometry.coordinates).match(/-?\d+\.\d+/g) ?? [];
    expect(coords.every((c) => c.split(".")[1]!.length <= 6)).toBe(true);
  });

  it("refuses a copy over the point cap, saying how much to simplify", async () => {
    // 6,000 points about 230 m apart, spikes 2 km long: the buffer can't
    // close the gaps between them, and simplifying keeps every one.
    const area: RegionPolygon = { type: "Polygon", coordinates: [star(-108, 37, 2, 0.02, 6_001)] };
    const r = await device.buildDeviceArea(area, exec);
    expect(r).toMatchObject({ ok: false, reason: "too_many_points" });
    expect(r.points).toBeGreaterThan(device.DEVICE_AREA_MAX_POINTS);
    expect(device.deviceAreaRefusal(r)).toMatch(/On phones the area needs [\d,]+ points; the limit is 5,000\. Remove about \d+%/);
  });
});
