import { describe, expect, it } from "vitest";

import { advertiserTabs, teamTabs } from "@/lib/nav/sections";

// A team's and an advertiser's tab bars show each role only the pages that
// let it in, so no tab leads to a refusal.

const ORG = "11111111-1111-4111-8111-111111111111";
const labels = (tabs: Array<{ label: string }>) => tabs.map((t) => t.label);

describe("teamTabs", () => {
  it("gives admins every page, and Application only while the application is under review", () => {
    expect(labels(teamTabs(ORG, "admin", "pending"))).toEqual(["Members", "Alerts", "Terms", "Application"]);
    expect(labels(teamTabs(ORG, "admin", "approved"))).toEqual(["Members", "Alerts", "Terms"]);
    expect(teamTabs(ORG, "admin", "approved")[1]).toEqual({ href: `/sar/${ORG}/alerts`, label: "Alerts" });
  });

  it("gives dispatchers Alerts only and responders nothing (no page admits them)", () => {
    expect(labels(teamTabs(ORG, "dispatcher", "approved"))).toEqual(["Alerts"]);
    expect(teamTabs(ORG, "responder", "approved")).toEqual([]);
  });
});

describe("advertiserTabs", () => {
  it("shows Team to the account's admins only", () => {
    expect(labels(advertiserTabs("a1", "admin"))).toEqual(["Ads", "Team"]);
    expect(advertiserTabs("a1", "editor")).toEqual([{ href: "/advertiser/a1/creatives", label: "Ads" }]);
  });
});
