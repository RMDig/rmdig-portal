import { readFileSync } from "node:fs";
import { join } from "node:path";

import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

// AvServ's shared SAR service-area vectors (AvServ #188,
// internal/sargeo/testdata/area_vectors.json, copied verbatim to
// tests/fixtures/sar-area-vectors.json; change only in coordinated PRs). The
// portal and AvServ must never disagree about who serves a place, so any area
// predicate the portal uses must pass these. They hold for PostGIS GEOMETRY
// ST_Covers / ST_Intersects (planar, like AvServ's sargeo); geography
// ST_Covers fails "on a hole vertex", which is why the portal uses neither it
// nor a matcher of its own (AvServ matches; the portal only syncs areas).
//
// Run: INTEGRATION_DATABASE_URL=postgresql://postgres:pw@127.0.0.1:55432/postgres pnpm test:integration

const url = process.env.INTEGRATION_DATABASE_URL;
if (!url) throw new Error("Set INTEGRATION_DATABASE_URL to a local PostGIS database.");
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") {
  throw new Error(`Refusing non-local INTEGRATION_DATABASE_URL host ${host}: integration tests never touch Neon.`);
}

type Area = { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
const vectors = JSON.parse(readFileSync(join(process.cwd(), "tests", "fixtures", "sar-area-vectors.json"), "utf8")) as {
  schemaVersion: number;
  areas: Record<string, Area>;
  points: Array<{ area: string; name: string; lon: number; lat: number; covered: boolean }>;
  routes: Array<{ area: string; name: string; lines: number[][][]; touches: boolean }>;
  circles: Array<{ area: string; name: string; lon: number; lat: number; radiusMeters: number; matches: boolean }>;
};
const sql = postgres(url, { max: 1, onnotice: () => {} });
afterAll(() => sql.end());
const area = (name: string) => JSON.stringify(vectors.areas[name]);

describe("shared SAR area vectors (PostGIS geometry semantics)", () => {
  it("is the schema version AvServ ships", () => {
    expect(vectors.schemaVersion).toBe(1);
  });

  it.each(vectors.points)("point $area / $name → covered=$covered", async (p) => {
    const [row] = await sql<{ v: boolean }[]>`
      SELECT ST_Covers(ST_SetSRID(ST_GeomFromGeoJSON(${area(p.area)}), 4326),
                       ST_SetSRID(ST_MakePoint(${p.lon}, ${p.lat}), 4326)) AS v`;
    expect(row!.v).toBe(p.covered);
  });

  it.each(vectors.routes)("route $area / $name → touches=$touches", async (r) => {
    const lines = JSON.stringify({ type: "MultiLineString", coordinates: r.lines });
    const [row] = await sql<{ v: boolean }[]>`
      SELECT ST_Intersects(ST_SetSRID(ST_GeomFromGeoJSON(${area(r.area)}), 4326),
                           ST_SetSRID(ST_GeomFromGeoJSON(${lines}), 4326)) AS v`;
    expect(row!.v).toBe(r.touches);
  });

  it.each(vectors.circles)("circle $area / $name → matches=$matches", async (c) => {
    const [row] = await sql<{ v: boolean }[]>`
      SELECT ST_DWithin(ST_SetSRID(ST_GeomFromGeoJSON(${area(c.area)}), 4326)::geography,
                        ST_SetSRID(ST_MakePoint(${c.lon}, ${c.lat}), 4326)::geography, ${c.radiusMeters}) AS v`;
    expect(row!.v).toBe(c.matches);
  });
});
