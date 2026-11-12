import { describe, expect, it } from "vitest";

import { advertiserTabs, managesLeaving, teamTabs } from "@/lib/nav/sections";
import { isPastTeam } from "@/lib/sar/team-status";

// A team's and an advertiser's tab bars show each role only the pages that
// let it in, so no tab leads to a refusal.

const ORG = "11111111-1111-4111-8111-111111111111";
const labels = (tabs: Array<{ label: string }>) => tabs.map((t) => t.label);

describe("teamTabs", () => {
  it("gives admins every page: Application while under review, Service area once approved, Leaving while active or leaving", () => {
    expect(labels(teamTabs(ORG, "admin", "pending"))).toEqual(["Members", "Alerts", "Terms", "Application"]);
    expect(labels(teamTabs(ORG, "admin", "approved"))).toEqual(["Members", "Alerts", "Terms", "Service area", "Leaving"]);
    expect(labels(teamTabs(ORG, "admin", "leaving"))).toEqual(["Members", "Alerts", "Terms", "Leaving"]);
    expect(teamTabs(ORG, "admin", "leaving")[3]).toEqual({ href: `/sar/${ORG}/leave`, label: "Leaving" });
    expect(teamTabs(ORG, "admin", "approved")[3]).toEqual({ href: `/sar/${ORG}/area`, label: "Service area" });
    expect(labels(teamTabs(ORG, "admin", "suspended"))).toEqual(["Members", "Alerts", "Terms"]);
    expect(teamTabs(ORG, "admin", "approved")[1]).toEqual({ href: `/sar/${ORG}/alerts`, label: "Alerts" });
  });

  it("gives dispatchers Alerts only and responders nothing (no page admits them)", () => {
    expect(labels(teamTabs(ORG, "dispatcher", "approved"))).toEqual(["Alerts"]);
    expect(teamTabs(ORG, "responder", "approved")).toEqual([]);
  });
});

describe("managesLeaving (the Leaving tab and the dashboard's Leaving link)", () => {
  it("is an admin of an approved or leaving team only", () => {
    expect(managesLeaving("admin", "approved")).toBe(true);
    expect(managesLeaving("admin", "leaving")).toBe(true);
    for (const s of ["pending", "rejected", "suspended", "withdrawn"]) expect(managesLeaving("admin", s)).toBe(false);
    expect(managesLeaving("dispatcher", "approved")).toBe(false);
    expect(managesLeaving("responder", "leaving")).toBe(false);
  });
});

describe("isPastTeam", () => {
  it("is a team that wasn't approved or has withdrawn; every other status is current", () => {
    expect(isPastTeam("rejected")).toBe(true);
    expect(isPastTeam("withdrawn")).toBe(true);
    for (const s of ["pending", "approved", "suspended", "leaving"]) expect(isPastTeam(s)).toBe(false);
  });
});

describe("advertiserTabs", () => {
  it("shows Team to the account's admins only", () => {
    expect(labels(advertiserTabs("a1", "admin"))).toEqual(["Ads", "Team"]);
    expect(advertiserTabs("a1", "editor")).toEqual([{ href: "/advertiser/a1/creatives", label: "Ads" }]);
  });
});
