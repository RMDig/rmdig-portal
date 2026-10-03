import { describe, expect, it } from "vitest";

import { FORBIDDEN_PUBLIC_PHRASES } from "@/lib/legal/compliance-copy";
import { circleRing, ringsBounds, unionBounds } from "@/lib/map/geometry";
import { allOrgsLayer, layersFor, memberOrgLayer, targetLayer, type OrgRow, type TargetRow } from "@/lib/map/layers";

// /map Phase 1 (docs/plans/33): pure geometry, the layer builders, and who
// gets which layer. Everything is scoped to the viewer; only staff see every
// organization; nothing claims monitoring or routing.

const square: number[][][] = [[[-106, 39], [-105, 39], [-105, 40], [-106, 40], [-106, 39]]];
const org = (id: string, status: OrgRow["status"], coordinates: number[][][] | null = square): OrgRow => ({
  id,
  name: `Org ${id}`,
  status,
  coordinates,
});
const radius = (id: string, status = "approved"): TargetRow => ({
  id,
  headline: `Ad ${id}`,
  status,
  description: "Within 30 mi of 39.74, -105.00",
  radius: { lat: 39.74, lon: -105, mi: 30 },
});
const admin = (id: string): TargetRow => ({
  id,
  headline: `Ad ${id}`,
  status: "approved",
  description: "Summit County, CO (county)",
  radius: null,
});

describe("geometry", () => {
  it("bounds a polygon and unions several", () => {
    expect(ringsBounds(square)).toEqual([[-106, 39], [-105, 40]]);
    expect(unionBounds([ringsBounds(square), [[-110, 38], [-109, 38.5]], null])).toEqual([[-110, 38], [-105, 40]]);
    expect(unionBounds([null])).toBeNull();
    expect(ringsBounds([])).toBeNull();
  });

  it("draws a closed circle of roughly the right size", () => {
    const ring = circleRing(-105, 39.74, 30);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    const [[, minLat], [, maxLat]] = ringsBounds([ring])!;
    // 30 mi ≈ 48.3 km ≈ 0.437° of latitude each way.
    expect(maxLat - minLat).toBeCloseTo(0.874, 2);
  });
});

describe("layer builders", () => {
  it("shows a member's orgs with their status and marks a missing area", () => {
    const layer = memberOrgLayer([org("a", "approved"), org("b", "pending", null)]);
    expect(layer.items.map((i) => [i.label, i.detail, i.dashed])).toEqual([
      ["Org a", "Approved", false],
      ["Org b", "Under review · no service area on file", true],
    ]);
    expect(layer.items[1]!.bounds).toBeNull();
    expect(layer.legend.map((l) => l.label)).toEqual(["Approved", "Under review"]);
  });

  it("leaves rejected orgs out of the staff overview", () => {
    expect(allOrgsLayer([org("a", "approved"), org("r", "rejected")]).items.map((i) => i.id)).toEqual(["org:a"]);
  });

  it("draws radius targets and lists admin targets without inventing a shape", () => {
    const layer = targetLayer([radius("1"), admin("2"), radius("3", "pending")]);
    expect(layer.items[0]!.rings).not.toBeNull();
    expect(layer.items[1]!.rings).toBeNull();
    expect(layer.items[1]!.detail).toContain("area not drawn");
    expect(layer.items[2]!.dashed).toBe(true);
  });
});

describe("layersFor", () => {
  const base = { isStaff: false, memberOrgs: [] as OrgRow[], isAdvertiser: false, targets: [] as TargetRow[], allOrgs: null };

  it("gives a plain user nothing", () => {
    expect(layersFor(base)).toEqual([]);
  });

  it("gives SAR members and advertisers only their own layers", () => {
    expect(layersFor({ ...base, memberOrgs: [org("a", "approved")] }).map((l) => l.id)).toEqual(["my-orgs"]);
    expect(layersFor({ ...base, isAdvertiser: true }).map((l) => l.id)).toEqual(["my-targets"]);
  });

  it("adds the all-organizations layer only for staff", () => {
    expect(layersFor({ ...base, allOrgs: [org("a", "approved")] }).map((l) => l.id)).toEqual([]);
    expect(layersFor({ ...base, isStaff: true, allOrgs: [org("a", "approved")] }).map((l) => l.id)).toEqual(["all-orgs"]);
  });
});

describe("map copy", () => {
  it("makes no forbidden claim and never implies watching, coverage or routing", () => {
    const layers = [
      memberOrgLayer([org("a", "approved"), org("b", "pending"), org("c", "suspended")]),
      allOrgsLayer([org("a", "approved")]),
      targetLayer([radius("1")]),
    ];
    const text = layers
      .flatMap((l) => [l.label, l.emptyText, ...l.legend.map((x) => x.label), ...l.items.map((i) => i.detail)])
      .join(" ")
      .toLowerCase();
    for (const p of [...FORBIDDEN_PUBLIC_PHRASES, "monitor", "watch", "coverage", "live", "rout"]) {
      expect(text, p).not.toContain(p);
    }
  });
});
