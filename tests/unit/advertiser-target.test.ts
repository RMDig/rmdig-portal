import { describe, expect, it } from "vitest";

import {
  adTargetSchema,
  adTargetToColumns,
  columnsToAdTarget,
  parseTargetFromFormData,
} from "@/lib/advertiser/target";
import type { CreativeTarget } from "@/lib/avserv/client";

describe("adTargetSchema (doc 31 §3)", () => {
  it("accepts national", () => {
    expect(adTargetSchema.safeParse({ kind: "national" }).success).toBe(true);
  });

  it("coerces + accepts a valid radius", () => {
    const r = adTargetSchema.safeParse({ kind: "radius", lat: "39.74", lon: "-105.0", mi: "30" });
    expect(r.success).toBe(true);
    if (r.success && r.data.kind === "radius") {
      expect(r.data.lat).toBeCloseTo(39.74);
      expect(r.data.mi).toBe(30);
    }
  });

  it("rejects a radius outside 5–250 mi", () => {
    expect(adTargetSchema.safeParse({ kind: "radius", lat: 39, lon: -105, mi: 400 }).success).toBe(false);
    expect(adTargetSchema.safeParse({ kind: "radius", lat: 39, lon: -105, mi: 3 }).success).toBe(false);
  });

  it("rejects an out-of-range latitude", () => {
    expect(adTargetSchema.safeParse({ kind: "radius", lat: 200, lon: -105, mi: 30 }).success).toBe(false);
  });

  it("accepts an admin set and rejects an empty one", () => {
    expect(adTargetSchema.safeParse({ kind: "admin", level: "state", fips: ["08"] }).success).toBe(true);
    expect(adTargetSchema.safeParse({ kind: "admin", level: "county", fips: [] }).success).toBe(false);
  });

  it("rejects a FIPS whose length doesn't match its level", () => {
    // a county code under level:state
    expect(adTargetSchema.safeParse({ kind: "admin", level: "state", fips: ["08013"] }).success).toBe(false);
    // a 2-digit code under level:place
    expect(adTargetSchema.safeParse({ kind: "admin", level: "place", fips: ["08"] }).success).toBe(false);
  });
});

describe("parseTargetFromFormData", () => {
  it("reads a radius target", () => {
    const fd = new FormData();
    fd.set("targetKind", "radius");
    fd.set("targetLat", "39.74");
    fd.set("targetLon", "-105.0");
    fd.set("targetRadiusMi", "25");
    const r = parseTargetFromFormData(fd);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual({ kind: "radius", lat: 39.74, lon: -105, mi: 25 });
  });

  it("reads repeated fips inputs into an admin set", () => {
    const fd = new FormData();
    fd.set("targetKind", "admin");
    fd.set("targetAdminLevel", "county");
    fd.append("fips", "08013");
    fd.append("fips", "08117");
    const r = parseTargetFromFormData(fd);
    expect(r.success).toBe(true);
    if (r.success && r.data.kind === "admin") expect(r.data.fips).toEqual(["08013", "08117"]);
  });

  it("defaults to national when targetKind is absent", () => {
    const r = parseTargetFromFormData(new FormData());
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.kind).toBe("national");
  });
});

describe("column mapping round-trips", () => {
  const cases: CreativeTarget[] = [
    { kind: "national" },
    { kind: "radius", lat: 39.74, lon: -105, mi: 30 },
    { kind: "admin", level: "place", fips: ["0820000"] },
  ];
  it.each(cases)("%o → columns → target", (target) => {
    expect(columnsToAdTarget(adTargetToColumns(target))).toEqual(target);
  });

  it("stores numeric lat/lon as strings and nulls unused columns", () => {
    const cols = adTargetToColumns({ kind: "radius", lat: 39.74, lon: -105, mi: 30 });
    expect(cols.targetLat).toBe("39.74");
    expect(cols.targetAdminFips).toBeNull();
    const nat = adTargetToColumns({ kind: "national" });
    expect(nat).toMatchObject({ targetKind: "national", targetLat: null, targetAdminLevel: null });
  });
});
