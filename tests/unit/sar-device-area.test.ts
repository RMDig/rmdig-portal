import { describe, expect, it, vi } from "vitest";

// The pure parts of the device copy (AvApp plan 68; lib/sar/device-area.ts):
// the geometry it accepts and what a refused save tells the team. The copy
// itself is built in PostGIS (tests/integration/sar-device-area.test.ts).

vi.mock("@/lib/db", () => ({ db: {} }));

import { DEVICE_AREA_MAX_POINTS, DeviceAreaGeometrySchema, deviceAreaRefusal } from "@/lib/sar/device-area";

const ring: [number, number][] = [[-106, 39], [-105, 39], [-105, 40], [-106, 39]];

describe("DeviceAreaGeometrySchema", () => {
  it("accepts a Polygon and a MultiPolygon", () => {
    expect(DeviceAreaGeometrySchema.safeParse({ type: "Polygon", coordinates: [ring] }).success).toBe(true);
    expect(DeviceAreaGeometrySchema.safeParse({ type: "MultiPolygon", coordinates: [[ring], [ring]] }).success).toBe(true);
  });

  it("rejects other types, open rings and empty shapes", () => {
    expect(DeviceAreaGeometrySchema.safeParse({ type: "LineString", coordinates: ring }).success).toBe(false);
    expect(DeviceAreaGeometrySchema.safeParse({ type: "Polygon", coordinates: [ring.slice(0, 3).concat([[-104, 41]])] }).success).toBe(false);
    expect(DeviceAreaGeometrySchema.safeParse({ type: "MultiPolygon", coordinates: [] }).success).toBe(false);
  });
});

describe("deviceAreaRefusal", () => {
  it("is null for a good copy", () => {
    expect(deviceAreaRefusal({ ok: true, points: 10, deviceArea: { geometry: { type: "Polygon", coordinates: [ring] }, toleranceMeters: 50, bufferMeters: 51 } })).toBeNull();
  });

  it("tells the team how much to simplify an area over the cap", () => {
    expect(DEVICE_AREA_MAX_POINTS).toBe(5_000);
    expect(deviceAreaRefusal({ ok: false, reason: "too_many_points", points: 10_000 })).toBe(
      "On phones the area needs 10,000 points; the limit is 5,000. Remove about 50% of its points, or smooth its edges.",
    );
    expect(deviceAreaRefusal({ ok: false, reason: "too_many_points", points: 5_001 })).toMatch(/Remove about 1%/);
  });

  it("refuses a copy that doesn't cover the area, or has no shape, without blaming the team", () => {
    for (const reason of ["not_covering", "no_shape"] as const) {
      expect(deviceAreaRefusal({ ok: false, reason, points: null })).toMatch(/couldn't be prepared for phones.*contact rmdig support/);
    }
  });
});
