import { describe, expect, it } from "vitest";

import {
  allFipsExist,
  describeTarget,
  listStates,
  lookupAdmin,
  searchAdmin,
} from "@/lib/geo/lookup";

// Exercises the bundled Census reference data (lib/geo/data/*.json) through the
// server-side lookup. Pure (reads committed JSON, no DB) — keep it that way per the
// repo's CI/test-scope constraint.

describe("searchAdmin", () => {
  it("finds a state by name (case-insensitive)", () => {
    const r = searchAdmin("state", "colo");
    expect(r.some((u) => u.fips === "08" && u.name === "Colorado")).toBe(true);
  });

  it("scopes counties to a state and finds Summit County, CO", () => {
    const r = searchAdmin("county", "summit", { state: "CO" });
    expect(r.some((u) => u.fips === "08117")).toBe(true);
    expect(r.every((u) => u.usps === "CO")).toBe(true);
  });

  it("ranks prefix matches before interior substring matches", () => {
    const r = searchAdmin("place", "boulder", { state: "CO" });
    const boulderCity = r.findIndex((u) => u.name.toLowerCase().startsWith("boulder"));
    expect(boulderCity).toBe(0);
  });

  it("caps results", () => {
    expect(searchAdmin("place", "a", { limit: 10 }).length).toBeLessThanOrEqual(10);
  });

  it("browses a state's counties with an empty query + scope", () => {
    const r = searchAdmin("county", "", { state: "CO" });
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((u) => u.usps === "CO")).toBe(true);
  });
});

describe("listStates / lookupAdmin / allFipsExist", () => {
  it("lists 50 states + DC + PR", () => {
    const states = listStates();
    expect(states.length).toBe(52);
    expect(states.some((s) => s.usps === "DC")).toBe(true);
  });

  it("looks up a unit by fips and returns undefined for an unknown one", () => {
    expect(lookupAdmin("state", "08")?.name).toBe("Colorado");
    expect(lookupAdmin("county", "99999")).toBeUndefined();
  });

  it("validates FIPS existence", () => {
    expect(allFipsExist("county", ["08117"])).toBe(true);
    expect(allFipsExist("county", ["08117", "99999"])).toBe(false);
  });
});

describe("describeTarget", () => {
  const base = {
    targetLat: null,
    targetLon: null,
    targetRadiusMi: null,
    targetAdminLevel: null,
    targetAdminFips: null,
  } as const;

  it("describes national", () => {
    expect(describeTarget({ ...base, targetKind: "national" })).toMatch(/national/i);
  });

  it("describes a radius", () => {
    const s = describeTarget({
      ...base,
      targetKind: "radius",
      targetLat: "39.74",
      targetLon: "-105.0",
      targetRadiusMi: 30,
    });
    expect(s).toContain("30 mi");
    expect(s).toContain("39.74");
  });

  it("resolves admin FIPS to names", () => {
    const s = describeTarget({
      ...base,
      targetKind: "admin",
      targetAdminLevel: "state",
      targetAdminFips: ["08"],
    });
    expect(s).toContain("Colorado");
  });
});
