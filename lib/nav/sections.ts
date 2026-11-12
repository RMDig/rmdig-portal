import { isPastTeam } from "../sar/team-status";

// The tab bars inside a team's and an advertiser's pages. Pure: each tab is
// shown only to the roles its page lets in, so no tab leads to a refusal.

export interface SectionTab {
  href: string;
  label: string;
}

/** Whether this member gives and undoes the team's leaving notice: an admin
 *  of an approved or leaving team (plan 33 §6.9 F5). */
export function managesLeaving(role: "admin" | "dispatcher" | "responder", status: string): boolean {
  return role === "admin" && (status === "approved" || status === "leaving");
}

export function teamTabs(orgId: string, role: "admin" | "dispatcher" | "responder", status: string): SectionTab[] {
  const base = `/sar/${orgId}`;
  if (role === "dispatcher") return [{ href: `${base}/alerts`, label: "Alerts" }];
  if (role !== "admin") return [];
  return [
    { href: `${base}/members`, label: "Members" },
    { href: `${base}/alerts`, label: "Alerts" },
    { href: `${base}/terms`, label: "Terms" },
    // Only an application under review can be edited; an approved team edits
    // its own service area (plan 33 D3).
    ...(status === "pending" ? [{ href: `${base}/edit`, label: "Application" }] : []),
    ...(status === "approved" ? [{ href: `${base}/area`, label: "Service area" }] : []),
    // The team's check-out limit and each server's count (plan 33 9.7).
    ...(!isPastTeam(status) ? [{ href: `${base}/checkouts`, label: "Check-outs" }] : []),
    // A team gives and undoes its own leaving notice (plan 33 §6.9).
    ...(managesLeaving(role, status) ? [{ href: `${base}/leave`, label: "Leaving" }] : []),
  ];
}

export function advertiserTabs(advertiserId: string, role: "admin" | "editor"): SectionTab[] {
  const base = `/advertiser/${advertiserId}`;
  return [
    { href: `${base}/creatives`, label: "Ads" },
    ...(role === "admin" ? [{ href: `${base}/members`, label: "Team" }] : []),
  ];
}
