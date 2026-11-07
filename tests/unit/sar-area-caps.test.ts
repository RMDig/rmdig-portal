import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { AVSERV_AREA_CAPS, checkAvservCaps, LIVE_ORG_STATUSES, serviceAreaBytes } from "@/lib/sar/area-checks";
import type { RegionPolygon } from "@/lib/sar/geo";

type Ring = RegionPolygon["coordinates"][number];

// AvServ's caps on a team's area (internal/sargeo/sargeo.go,
// internal/api/sarteams.go): over any of them every node refuses the sync, so
// the portal refuses the save first and says how much to simplify (plan 33
// §6.3 step 3). The PostGIS side is tests/integration/sar-area-checks.test.ts.

const ring = (count: number, x0 = -105): Ring => {
  const r: Ring = Array.from({ length: count - 1 }, (_, i) => [x0 + i * 1e-3, 39 + (i % 2) * 1e-3]);
  return [...r, r[0]!];
};
const poly = (...rings: Ring[]): RegionPolygon => ({ type: "Polygon", coordinates: rings });

describe("checkAvservCaps", () => {
  it("passes an ordinary area and reports what it measured", () => {
    const area = poly(ring(5));
    expect(checkAvservCaps(area)).toEqual({ ok: true, bytes: serviceAreaBytes(area), vertices: 5 });
  });

  it("measures the compact serviceArea JSON the sync body carries", () => {
    const area = poly([[0, 0], [1, 0], [1, 1], [0, 0]]);
    expect(serviceAreaBytes(area)).toBe('{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}'.length);
  });

  it("refuses a ring too small to keep, naming the outline or the hole", () => {
    expect(checkAvservCaps(poly([[0, 0], [1, 1], [0, 0]]))).toMatchObject({ ok: false, code: "area_invalid", message: expect.stringMatching(/^The outline is too small/) });
    expect(checkAvservCaps(poly(ring(5), [[0, 0], [1, 1], [0, 0]]))).toMatchObject({ ok: false, message: expect.stringMatching(/^Hole 1 is too small/) });
  });

  it("refuses a ring over 10,000 points, saying how much to remove", () => {
    const r = checkAvservCaps(poly(ring(12_500)));
    expect(r).toMatchObject({ ok: false, code: "area_invalid" });
    if (!r.ok) expect(r.message).toBe("The outline has 12,500 points; the limit is 10,000. Remove about 20% of its points.");
  });

  it("refuses over 100,000 points in all", () => {
    const rings = Array.from({ length: 11 }, (_, i) => ring(10_000, -105 + i));
    const r = checkAvservCaps(poly(...rings));
    expect(r).toMatchObject({ ok: false, code: "area_invalid", vertices: 110_000 });
    if (!r.ok) expect(r.message).toMatch(/110,000 points; the limit is 100,000\. Remove about 10% of its points\./);
  });

  it("refuses an area over 1 MiB as area_too_large", () => {
    // Pad coordinates to long decimals until the area is just over the cap.
    const long = (count: number): Ring => {
      const r: Ring = Array.from({ length: count - 1 }, (_, i) => [-105.123456789012 - i * 1e-9, 39.123456789012 + i * 1e-9]);
      return [...r, r[0]!];
    };
    const rings = Array.from({ length: 5 }, () => long(9_000));
    const area = poly(...rings);
    const bytes = serviceAreaBytes(area);
    expect(bytes).toBeGreaterThan(AVSERV_AREA_CAPS.bytes);
    const r = checkAvservCaps(area);
    expect(r).toMatchObject({ ok: false, code: "area_too_large", bytes });
    if (!r.ok) expect(r.message).toMatch(/^The area is \d\.\d\d MiB once simplified; the limit is 1 MiB\. Remove about \d+% of its points\.$/);
  });

  it("treats withdrawn and rejected teams as gone, everything else as live", () => {
    expect([...LIVE_ORG_STATUSES].sort()).toEqual(["approved", "leaving", "pending", "suspended"]);
  });
});
