import { describe, expect, it } from "vitest";

import { checkDrillArea, circleRing, DRILL_AREA_DEFAULT, DRILL_AREA_MAX_KM2 } from "@/lib/sar/drill";
import { RegionPolygonSchema } from "@/lib/sar/geo";
import { registerDrillOrgSchema } from "@/lib/sar/schema";

// A drill team's own rules (plan 37 §4.3–§4.4), on top of the ordinary checks.

const assessed = (areaKm2: number, overlaps: Array<{ orgId: string; name: string; status: "approved"; overlapKm2: number }> = []) => ({
  ok: true as const,
  area: RegionPolygonSchema.parse({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }),
  areaKm2,
  bytes: 1,
  vertices: 4,
  overlaps,
  clip: null,
});

describe("checkDrillArea", () => {
  it("accepts a small area that overlaps no real team", () => {
    expect(checkDrillArea(assessed(3.1))).toEqual({ ok: true });
    expect(checkDrillArea(assessed(DRILL_AREA_MAX_KM2))).toEqual({ ok: true });
  });

  it("refuses an area over the cap, saying how big it is", () => {
    expect(checkDrillArea(assessed(4.01))).toMatchObject({ ok: false, code: "drill_area_too_large", message: expect.stringContaining("This one is 4.0 km²") });
  });

  it("refuses any overlap with a real team, without naming it", () => {
    const r = checkDrillArea(assessed(1, [{ orgId: "x", name: "Denver SAR", status: "approved", overlapKm2: 0.1 }]));
    expect(r).toMatchObject({ ok: false, code: "drill_area_overlaps" });
    expect(r.ok || r.message.includes("Denver")).toBe(false);
  });
});

describe("the default drill area (owner, 2026-11-09)", () => {
  const ring = circleRing(DRILL_AREA_DEFAULT, DRILL_AREA_DEFAULT.radiusM);

  it("is a closed polygon the area schema accepts", () => {
    expect(ring).toHaveLength(33);
    expect(ring[0]).toEqual(ring[32]);
    expect(RegionPolygonSchema.safeParse({ type: "Polygon", coordinates: [ring] }).success).toBe(true);
  });

  it("is about 1 km from the Capitol on every side", () => {
    const toM = ([lon, lat]: number[]) => {
      const dy = (lat! - DRILL_AREA_DEFAULT.lat) * 111_320;
      const dx = (lon! - DRILL_AREA_DEFAULT.lon) * 111_320 * Math.cos((DRILL_AREA_DEFAULT.lat * Math.PI) / 180);
      return Math.hypot(dx, dy);
    };
    for (const p of ring) expect(Math.abs(toM(p) - 1000)).toBeLessThan(1);
  });

  it("fits under the drill cap (a 1 km circle is about 3.1 km²)", () => {
    expect(Math.PI * 1 ** 2).toBeLessThan(DRILL_AREA_MAX_KM2);
  });
});

describe("registerDrillOrgSchema", () => {
  const base = { name: "AvAI Drill Team", contactName: "Ops", contactEmail: "OPS@rmdig.ai", region: JSON.stringify({ type: "Polygon", coordinates: [circleRing(DRILL_AREA_DEFAULT, 1000)] }) };

  it("accepts 'drill' in any case and lowercases the contact email", () => {
    const r = registerDrillOrgSchema.safeParse({ ...base, name: "capitol DRILL" });
    expect(r.success && r.data.contactEmail).toBe("ops@rmdig.ai");
  });

  it("refuses a name without 'drill', a missing contact, and a missing area", () => {
    expect(registerDrillOrgSchema.safeParse({ ...base, name: "Test Team" }).success).toBe(false);
    expect(registerDrillOrgSchema.safeParse({ ...base, contactName: " " }).success).toBe(false);
    expect(registerDrillOrgSchema.safeParse({ ...base, region: "" }).success).toBe(false);
  });
});
