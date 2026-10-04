import type { ShareLogResult } from "../avserv/share-log";

// Which SAR teams received an account's data, merged from every AvServ node
// (AvServ plan 41 §10.3), for the operator working a deletion request. Pure.
// Drill traffic is dropped. A node that didn't answer makes the answer
// "incomplete", never "no teams": a missed team is a missed deletion notice.

export interface TeamDisclosure {
  teamId: string;
  dispatches: number;
  feedReads: number;
  /** Every field any disclosure carried (e.g. lastFix, plannedRoute). */
  fields: string[];
  channels: string[];
  first: string;
  last: string;
  nodes: string[];
}

export interface ShareLogSummary {
  status: "complete" | "incomplete" | "error";
  teams: TeamDisclosure[];
  unavailable: Array<{ node: string; code: string }>;
  drillRowsSkipped: number;
}

export function summarizeShareLog(results: ShareLogResult[]): ShareLogSummary {
  const unavailable = results.flatMap((r) => (r.ok ? [] : [{ node: r.node, code: r.code }]));
  const answered = results.filter((r): r is Extract<ShareLogResult, { ok: true }> => r.ok);
  const byTeam = new Map<string, { t: TeamDisclosure; fields: Set<string>; channels: Set<string>; nodes: Set<string> }>();
  let drillRowsSkipped = 0;
  for (const r of answered) {
    for (const i of r.items) {
      if (i.drill) {
        drillRowsSkipped++;
        continue;
      }
      let e = byTeam.get(i.teamId);
      if (!e) {
        e = {
          t: { teamId: i.teamId, dispatches: 0, feedReads: 0, fields: [], channels: [], first: i.at, last: i.at, nodes: [] },
          fields: new Set(),
          channels: new Set(),
          nodes: new Set(),
        };
        byTeam.set(i.teamId, e);
      }
      if (i.kind === "dispatch") e.t.dispatches++;
      else e.t.feedReads++;
      for (const f of i.fields) e.fields.add(f);
      if (i.channel) e.channels.add(i.channel);
      e.nodes.add(i.node);
      if (i.at < e.t.first) e.t.first = i.at;
      if (i.at > e.t.last) e.t.last = i.at;
    }
  }
  const teams = [...byTeam.values()]
    .map((e) => ({ ...e.t, fields: [...e.fields].sort(), channels: [...e.channels].sort(), nodes: [...e.nodes].sort() }))
    .sort((a, b) => b.last.localeCompare(a.last));
  const status = answered.length === 0 ? "error" : unavailable.length > 0 ? "incomplete" : "complete";
  return { status, teams, unavailable, drillRowsSkipped };
}

/** Days left on the Colorado Privacy Act's 45-day clock from confirmation. */
export const CPA_DAYS = 45;
export function cpaDaysLeft(confirmedAt: Date, now: Date): number {
  return CPA_DAYS - Math.floor((now.getTime() - confirmedAt.getTime()) / 86_400_000);
}
