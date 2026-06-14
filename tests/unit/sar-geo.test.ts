import { describe, expect, it, vi } from "vitest";

// Stub the db client so importing geo.ts (which constructs a postgres client at
// module load) doesn't reach for a real DATABASE_URL. These cases exercise only
// the pure Zod boundary; the PostGIS helpers aren't called here.
vi.mock("@/lib/db", () => ({ db: {} }));

import { RegionPolygonSchema } from "@/lib/sar/geo";

// A closed unit square around the San Juans (lon/lat, WGS84).
const square = {
  type: "Polygon" as const,
  coordinates: [
    [
      [-108, 37],
      [-107, 37],
      [-107, 38],
      [-108, 38],
      [-108, 37],
    ],
  ],
};

describe("RegionPolygonSchema", () => {
  it("accepts a valid closed polygon", () => {
    expect(RegionPolygonSchema.safeParse(square).success).toBe(true);
  });

  it("accepts a polygon with an interior hole (multiple rings)", () => {
    const withHole = {
      type: "Polygon" as const,
      coordinates: [
        square.coordinates[0],
        [
          [-107.8, 37.2],
          [-107.2, 37.2],
          [-107.2, 37.8],
          [-107.8, 37.8],
          [-107.8, 37.2],
        ],
      ],
    };
    expect(RegionPolygonSchema.safeParse(withHole).success).toBe(true);
  });

  it("accepts positions carrying an optional elevation value", () => {
    const withZ = {
      type: "Polygon" as const,
      coordinates: [
        [
          [-108, 37, 1500],
          [-107, 37, 1500],
          [-107, 38, 1500],
          [-108, 38, 1500],
          [-108, 37, 1500],
        ],
      ],
    };
    expect(RegionPolygonSchema.safeParse(withZ).success).toBe(true);
  });

  it("rejects a non-Polygon geometry type", () => {
    expect(
      RegionPolygonSchema.safeParse({ type: "Point", coordinates: [-108, 37] }).success,
    ).toBe(false);
  });

  it("rejects a ring with fewer than four positions", () => {
    const tooFew = {
      type: "Polygon" as const,
      coordinates: [
        [
          [-108, 37],
          [-107, 37],
          [-108, 37],
        ],
      ],
    };
    expect(RegionPolygonSchema.safeParse(tooFew).success).toBe(false);
  });

  it("rejects an unclosed ring (last position not equal to first)", () => {
    const open = {
      type: "Polygon" as const,
      coordinates: [
        [
          [-108, 37],
          [-107, 37],
          [-107, 38],
          [-108, 38],
        ],
      ],
    };
    expect(RegionPolygonSchema.safeParse(open).success).toBe(false);
  });

  it("rejects out-of-range longitude", () => {
    const badLon = {
      type: "Polygon" as const,
      coordinates: [
        [
          [-200, 37],
          [-107, 37],
          [-107, 38],
          [-200, 38],
          [-200, 37],
        ],
      ],
    };
    expect(RegionPolygonSchema.safeParse(badLon).success).toBe(false);
  });

  it("rejects out-of-range latitude", () => {
    const badLat = {
      type: "Polygon" as const,
      coordinates: [
        [
          [-108, 91],
          [-107, 91],
          [-107, 38],
          [-108, 38],
          [-108, 91],
        ],
      ],
    };
    expect(RegionPolygonSchema.safeParse(badLat).success).toBe(false);
  });

  it("rejects empty coordinates", () => {
    expect(
      RegionPolygonSchema.safeParse({ type: "Polygon", coordinates: [] }).success,
    ).toBe(false);
  });
});
