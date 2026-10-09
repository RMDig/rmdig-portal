import { describe, expect, it, vi } from "vitest";

// Stub the db client so importing the schema (which pulls in lib/sar/geo →
// lib/db) doesn't construct a real postgres client. The DB *schema* (enum
// values) stays real — only the client is stubbed.
vi.mock("@/lib/db", () => ({ db: {} }));

import { createSarOrgSchema, updateSarOrgSchema } from "@/lib/sar/schema";

const validRegion = JSON.stringify({
  type: "Polygon",
  coordinates: [
    [
      [-108, 37],
      [-107, 37],
      [-107, 38],
      [-108, 38],
      [-108, 37],
    ],
  ],
});

const base = {
  name: "San Juan County SAR",
  contactName: "Jane Doe",
  contactEmail: "Jane@SAR.org",
  operatingStatus: "county_sar",
  region: validRegion,
  tosAccepted: "on",
};

describe("createSarOrgSchema", () => {
  it("accepts a valid submission and normalizes values", () => {
    const r = createSarOrgSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.contactEmail).toBe("jane@sar.org"); // lowercased
      expect(r.data.region.type).toBe("Polygon"); // parsed from JSON string
      expect(r.data.tosAccepted).toBe(true);
      expect(r.data.description).toBeUndefined(); // omitted optional
    }
  });

  it("collapses a blank optional field to undefined", () => {
    const r = createSarOrgSchema.safeParse({ ...base, regionName: "   " });
    expect(r.success && r.data.regionName).toBeUndefined();
  });

  it("rejects a missing name", () => {
    expect(createSarOrgSchema.safeParse({ ...base, name: "" }).success).toBe(false);
  });

  it("rejects an invalid contact email", () => {
    expect(createSarOrgSchema.safeParse({ ...base, contactEmail: "nope" }).success).toBe(false);
  });

  it("rejects an unknown operating status", () => {
    expect(createSarOrgSchema.safeParse({ ...base, operatingStatus: "made_up" }).success).toBe(
      false,
    );
  });

  it("requires the detail field when operating status is 'other'", () => {
    const r = createSarOrgSchema.safeParse({ ...base, operatingStatus: "other" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.operatingStatusOther).toBeDefined();
    }
  });

  it("accepts 'other' with a detail", () => {
    expect(
      createSarOrgSchema.safeParse({
        ...base,
        operatingStatus: "other",
        operatingStatusOther: "Volunteer ski patrol",
      }).success,
    ).toBe(true);
  });

  it("rejects an unaccepted TOS (checkbox absent)", () => {
    const withoutTos = {
      name: base.name,
      contactName: base.contactName,
      contactEmail: base.contactEmail,
      operatingStatus: base.operatingStatus,
      region: base.region,
    };
    expect(createSarOrgSchema.safeParse(withoutTos).success).toBe(false);
  });

  it("rejects malformed region JSON", () => {
    expect(createSarOrgSchema.safeParse({ ...base, region: "not json" }).success).toBe(false);
  });

  // The form shows these under the map, so they must be plain words, never
  // Zod's GeoJSON wording ("expected object, received string", 2026-10-08).
  it("asks for the area when none was drawn", () => {
    for (const region of ["", undefined]) {
      const res = createSarOrgSchema.safeParse({ ...base, region });
      expect(res.success).toBe(false);
      if (!res.success) expect(res.error.flatten().fieldErrors.region).toEqual(["Draw your service area on the map."]);
    }
  });

  it("explains an unreadable area in plain words", () => {
    for (const region of ["not json", JSON.stringify({ type: "Point", coordinates: [1, 2] })]) {
      const res = createSarOrgSchema.safeParse({ ...base, region });
      expect(res.success).toBe(false);
      if (!res.success) {
        const [message] = res.error.flatten().fieldErrors.region ?? [];
        expect(message).toMatch(/couldn't be read/);
        expect(message).not.toMatch(/expected|received/);
      }
    }
  });

  it("rejects a region that is not a valid polygon", () => {
    const openRing = JSON.stringify({
      type: "Polygon",
      coordinates: [
        [
          [-108, 37],
          [-107, 37],
          [-107, 38],
        ],
      ],
    });
    expect(createSarOrgSchema.safeParse({ ...base, region: openRing }).success).toBe(false);
  });
});

describe("org type and resubmission (docs/plans/33)", () => {
  const square = { type: "Polygon", coordinates: [[[-108, 37], [-107, 37], [-107, 38], [-108, 37]]] };
  const base = {
    name: "Summit Patrol",
    contactName: "Pat",
    contactEmail: "pat@ski.example",
    operatingStatus: "other",
    operatingStatusOther: "Resort-employed patrol",
    region: JSON.stringify(square),
    tosAccepted: "on",
  };

  it("defaults a new application to a search & rescue team and accepts a ski patrol", () => {
    expect(createSarOrgSchema.parse(base).orgType).toBe("sar_team");
    expect(createSarOrgSchema.parse({ ...base, orgType: "ski_patrol" }).orgType).toBe("ski_patrol");
  });

  it("rejects an unknown org type", () => {
    expect(createSarOrgSchema.safeParse({ ...base, orgType: "fire_department" }).success).toBe(false);
  });

  it("lets a resubmission keep the area on file when no new one is drawn", () => {
    const { region: _r, tosAccepted: _t, ...rest } = base;
    const parsed = updateSarOrgSchema.parse({ ...rest, region: "" });
    expect(parsed.region).toBeUndefined();
  });

  it("validates a redrawn area and still requires detail for 'other'", () => {
    const { tosAccepted: _t, ...rest } = base;
    expect(updateSarOrgSchema.parse(rest).region).toEqual(square);
    expect(updateSarOrgSchema.safeParse({ ...rest, region: "{bad" }).success).toBe(false);
    expect(updateSarOrgSchema.safeParse({ ...rest, operatingStatusOther: "" }).success).toBe(false);
  });
});
