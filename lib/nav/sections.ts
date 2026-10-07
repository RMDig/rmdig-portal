// The tab bars inside a team's and an advertiser's pages. Pure: each tab is
// shown only to the roles its page lets in, so no tab leads to a refusal.

export interface SectionTab {
  href: string;
  label: string;
}

export function teamTabs(orgId: string, role: "admin" | "dispatcher" | "responder", status: string): SectionTab[] {
  const base = `/sar/${orgId}`;
  if (role === "dispatcher") return [{ href: `${base}/alerts`, label: "Alerts" }];
  if (role !== "admin") return [];
  return [
    { href: `${base}/members`, label: "Members" },
    { href: `${base}/alerts`, label: "Alerts" },
    { href: `${base}/terms`, label: "Terms" },
    // Only an application under review can be edited.
    ...(status === "pending" ? [{ href: `${base}/edit`, label: "Application" }] : []),
  ];
}

export function advertiserTabs(advertiserId: string, role: "admin" | "editor"): SectionTab[] {
  const base = `/advertiser/${advertiserId}`;
  return [
    { href: `${base}/creatives`, label: "Creatives" },
    ...(role === "admin" ? [{ href: `${base}/members`, label: "Team" }] : []),
  ];
}
