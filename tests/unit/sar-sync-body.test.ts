import { describe, expect, it } from "vitest";

import { planSync, SERVICE_AREA_LABEL_MAX, type SyncOrg, type SyncTerms } from "@/lib/sar/sync-body";
import { createSarOrgSchema, updateSarOrgSchema } from "@/lib/sar/schema";

// The AvServ team-sync body (sar_team_sync.md §1), from the portal's records.

const now = new Date("2026-10-04T12:00:00Z");
const approvedAt = new Date("2026-10-01T09:00:00Z");
const area = [[[-106, 39], [-105, 39], [-105, 40], [-106, 39]]];
const org = (o: Partial<SyncOrg> = {}): SyncOrg => ({
  id: "11111111-1111-4111-8111-111111111111",
  name: "Summit County Rescue Group",
  orgType: "sar_team",
  status: "approved",
  approvedAt,
  approvedByUserId: "staff-1",
  verifiedAt: null,
  reverifyBy: null,
  leavingNoticeAt: null,
  regionName: "Summit County, CO",
  isDrill: false,
  oncallEmail: null,
  oncallEmailVerifiedAt: null,
  maxActiveCheckouts: null,
  acceptanceMode: "open",
  ...o,
});
const terms: SyncTerms = {
  version: 2,
  sha256: "ab".repeat(32),
  publishedAt: new Date("2026-10-02T10:00:00Z"),
  body: "We are volunteers.",
  requiresReacceptance: false,
  capabilities: [{ name: "checkout_alerts", channels: ["portal"] }, { name: "area_map", channels: [] }],
};

describe("planSync", () => {
  it("builds the contract body for an approved team", () => {
    const plan = planSync(org(), area, terms, 7, now);
    expect(plan).toEqual({
      send: true,
      body: {
        orgId: "11111111-1111-4111-8111-111111111111",
        revision: 7,
        status: "approved",
        leavingNoticeAt: null,
        orgType: "sar",
        displayName: "Summit County Rescue Group",
        approvedAt: "2026-10-01T09:00:00.000Z",
        approvedBy: "portal-user:staff-1",
        verifiedAt: null,
        reverifyBy: null,
        serviceArea: { type: "Polygon", coordinates: area },
        serviceAreaLabels: ["Summit County, CO"],
        publicListing: { consent: false, consentAt: null, websiteUrl: null, givingUrl: null, blurb: null, logoRef: null },
        channels: [{ kind: "portal", verifiedAt: "2026-10-01T09:00:00.000Z" }],
        terms: { ...terms, publishedAt: "2026-10-02T10:00:00.000Z" },
        updatedAt: "2026-10-04T12:00:00.000Z",
      },
    });
  });

  it("labels the area with the team's region name, trimmed, and none without one", () => {
    const labels = (regionName: string | null) => {
      const plan = planSync(org({ regionName }), area, terms, 1, now);
      return plan.send ? plan.body.serviceAreaLabels : undefined;
    };
    expect(labels("  Summit County, CO ")).toEqual(["Summit County, CO"]);
    expect(labels(null)).toEqual([]);
    expect(labels("   ")).toEqual([]);
  });

  it("never lists a team publicly until it consents (portal plan 34)", () => {
    for (const status of ["approved", "leaving", "suspended", "withdrawn"] as const) {
      const plan = planSync(org({ status }), area, terms, 1, now);
      expect(plan.send && plan.body.publicListing.consent).toBe(false);
    }
  });

  it("caps the region name at AvServ's label limit when it's entered", () => {
    const at = (regionName: string) =>
      [createSarOrgSchema, updateSarOrgSchema].map((schema) => {
        const r = schema.safeParse({ regionName });
        return !r.success && r.error.issues.some((i) => i.path[0] === "regionName");
      });
    expect(SERVICE_AREA_LABEL_MAX).toBe(100);
    expect(at("x".repeat(100))).toEqual([false, false]);
    expect(at("x".repeat(101))).toEqual([true, true]);
  });

  it("maps patrols, leaving teams and their notice time", () => {
    const plan = planSync(
      org({ orgType: "ski_patrol", status: "leaving", verifiedAt: approvedAt, reverifyBy: new Date("2027-10-01T09:00:00Z"), leavingNoticeAt: now }),
      area,
      terms,
      1,
      now,
    );
    expect(plan.send && plan.body).toMatchObject({ orgType: "patrol", status: "leaving", leavingNoticeAt: now.toISOString(), reverifyBy: "2027-10-01T09:00:00.000Z" });
  });

  it("sends suspended and withdrawn teams", () => {
    for (const status of ["suspended", "withdrawn"] as const) {
      const plan = planSync(org({ status }), area, terms, 1, now);
      expect(plan.send && plan.body.status).toBe(status);
    }
  });

  it("never sends pending or rejected orgs (AvServ only learns of approved teams)", () => {
    expect(planSync(org({ status: "pending" }), area, terms, 1, now)).toEqual({ send: false, reason: "not_syncable" });
    expect(planSync(org({ status: "rejected" }), area, terms, 1, now)).toEqual({ send: false, reason: "not_syncable" });
  });

  it("waits for published terms, a service area and the approval record", () => {
    expect(planSync(org(), area, null, 1, now)).toEqual({ send: false, reason: "no_published_terms" });
    expect(planSync(org(), null, terms, 1, now)).toEqual({ send: false, reason: "no_service_area" });
    expect(planSync(org({ approvedByUserId: null }), area, terms, 1, now)).toEqual({ send: false, reason: "approval_record_missing" });
  });
});

describe("planSync for a drill team (plan 37 §4.5)", () => {
  const drill = (o: Partial<SyncOrg> = {}) => org({ name: "AvAI Drill Team", isDrill: true, ...o });

  it("holds a drill team until every node supports drill, and never sends it without the flag", () => {
    expect(planSync(drill(), area, terms, 1, now)).toEqual({ send: false, reason: "drill_support_pending" });
    expect(planSync(drill(), area, terms, 1, now, false)).toEqual({ send: false, reason: "drill_support_pending" });
    const plan = planSync(drill(), area, terms, 1, now, true);
    expect(plan.send && plan.body.drill).toBe(true);
  });

  it("reports the team's own missing pieces before the drill hold", () => {
    expect(planSync(drill({ status: "pending" }), area, terms, 1, now)).toEqual({ send: false, reason: "not_syncable" });
    expect(planSync(drill(), area, null, 1, now)).toEqual({ send: false, reason: "no_published_terms" });
  });

  it("leaves the drill field out of a real team's body, so its body is unchanged", () => {
    for (const supported of [false, true]) {
      const plan = planSync(org(), area, terms, 1, now, supported);
      expect(plan.send && "drill" in plan.body).toBe(false);
    }
  });
});

describe("the check-out cap (plan 33 9.7, D5; sar_team_sync.md §5)", () => {
  it("sends a capped team's limit once every node supports it, and holds it until then", () => {
    expect(planSync(org({ maxActiveCheckouts: 25 }), area, terms, 1, now)).toEqual({ send: false, reason: "settings_support_pending" });
    const plan = planSync(org({ maxActiveCheckouts: 25 }), area, terms, 1, now, false, true);
    expect(plan.send && plan.body.maxActiveCheckouts).toBe(25);
  });

  it("leaves the field out for a team with no limit, held or not, so its body and hash are unchanged", () => {
    for (const supported of [false, true]) {
      const plan = planSync(org(), area, terms, 1, now, false, supported);
      expect(plan.send && "maxActiveCheckouts" in plan.body).toBe(false);
    }
  });

  it("holds a capped drill team for each gate it needs", () => {
    const capped = org({ name: "AvAI Drill Team", isDrill: true, maxActiveCheckouts: 3 });
    expect(planSync(capped, area, terms, 1, now, true, false)).toEqual({ send: false, reason: "settings_support_pending" });
    const plan = planSync(capped, area, terms, 1, now, true, true);
    expect(plan.send && [plan.body.drill, plan.body.maxActiveCheckouts]).toEqual([true, 3]);
  });
});

describe("confirm-first (plan 33 9.8, D4; sar_team_sync.md §5)", () => {
  it("sends acceptanceMode only for a confirm-first team, once every node supports it", () => {
    const cf = org({ acceptanceMode: "confirm_first" });
    expect(planSync(cf, area, terms, 1, now)).toEqual({ send: false, reason: "settings_support_pending" });
    const plan = planSync(cf, area, terms, 1, now, false, true);
    expect(plan.send && plan.body.acceptanceMode).toBe("confirm_first");
    const open = planSync(org(), area, terms, 1, now, false, true);
    expect(open.send && "acceptanceMode" in open.body).toBe(false);
  });

  it("sends both settings together", () => {
    const plan = planSync(org({ acceptanceMode: "confirm_first", maxActiveCheckouts: 8 }), area, terms, 1, now, false, true);
    expect(plan.send && [plan.body.acceptanceMode, plan.body.maxActiveCheckouts]).toEqual(["confirm_first", 8]);
  });
});

describe("the on-call email channel (plan 33 9.10)", () => {
  const confirmed = { oncallEmail: "dispatch@summitrescue.org", oncallEmailVerifiedAt: new Date("2026-10-03T08:00:00Z") };
  const byEmail: SyncTerms = { ...terms, capabilities: [{ name: "checkout_alerts", channels: ["portal", "email"] }] };

  it("sends the confirmed address as an email channel next to the portal", () => {
    const plan = planSync(org(confirmed), area, byEmail, 4, now);
    expect(plan.send && plan.body.channels).toEqual([
      { kind: "portal", verifiedAt: "2026-10-01T09:00:00.000Z" },
      { kind: "email", address: "dispatch@summitrescue.org", verifiedAt: "2026-10-03T08:00:00.000Z" },
    ]);
  });

  it("sends a confirmed address even under terms that don't list email yet", () => {
    const plan = planSync(org(confirmed), area, terms, 4, now);
    expect(plan.send && plan.body.channels.map((c) => c.kind)).toEqual(["portal", "email"]);
  });

  it("holds terms that send by email when no address is confirmed, rather than send a body AvServ refuses", () => {
    expect(planSync(org(), area, byEmail, 4, now)).toEqual({ send: false, reason: "email_channel_missing" });
  });
});
