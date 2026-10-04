import { describe, expect, it } from "vitest";

import { planSync, type SyncOrg, type SyncTerms } from "@/lib/sar/sync-body";

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
        channels: [{ kind: "portal", verifiedAt: "2026-10-01T09:00:00.000Z" }],
        terms: { ...terms, publishedAt: "2026-10-02T10:00:00.000Z" },
        updatedAt: "2026-10-04T12:00:00.000Z",
      },
    });
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
