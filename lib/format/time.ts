// Every date the portal shows is in Mountain time: AvAI and its operator run
// on it, and a server component would otherwise print the server's zone
// (UTC on Vercel). Pure, so pages, emails and the map all agree.

export const ZONE = "America/Denver";

/** "Tue, Oct 6, 7:19 PM MDT": a moment, for recent events. */
export function formatMountain(d: Date): string {
  return d.toLocaleString("en-US", {
    timeZone: ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/** "Oct 6, 2026": a day, for dates that can be months old or ahead. */
export function formatMountainDate(d: Date): string {
  return d.toLocaleDateString("en-US", { timeZone: ZONE, year: "numeric", month: "short", day: "numeric" });
}
