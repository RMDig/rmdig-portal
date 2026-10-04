import { describe, expect, it } from "vitest";

import type { ShareLogItem } from "@/lib/avserv/share-log";
import { cpaDaysLeft, summarizeShareLog } from "@/lib/deletion/share-log";

const row = (o: Partial<ShareLogItem> = {}): ShareLogItem => ({
  at: "2026-10-04T10:00:00Z",
  node: "avserv-2",
  teamId: "t1",
  kind: "dispatch",
  subject: "s",
  messageKind: "overdue",
  channel: "portal",
  fields: ["userDisplayName", "lastFix"],
  reader: null,
  drill: false,
  ...o,
});

describe("summarizeShareLog", () => {
  it("merges both nodes per team, skipping drill rows", () => {
    const s = summarizeShareLog([
      { ok: true, node: "a2", items: [row(), row({ kind: "feed_read", channel: null, fields: ["plannedRoute"], at: "2026-10-05T10:00:00Z" }), row({ drill: true, teamId: "drill-team" })] },
      { ok: true, node: "a3", items: [row({ node: "avserv-3", channel: "email", at: "2026-10-03T09:00:00Z" })] },
    ]);
    expect(s.status).toBe("complete");
    expect(s.drillRowsSkipped).toBe(1);
    expect(s.teams).toEqual([
      {
        teamId: "t1",
        dispatches: 2,
        feedReads: 1,
        fields: ["lastFix", "plannedRoute", "userDisplayName"],
        channels: ["email", "portal"],
        first: "2026-10-03T09:00:00Z",
        last: "2026-10-05T10:00:00Z",
        nodes: ["avserv-2", "avserv-3"],
      },
    ]);
  });

  it("is incomplete when a node didn't answer, and an error (never 'no teams') when none did", () => {
    expect(summarizeShareLog([{ ok: true, node: "a2", items: [] }, { ok: false, node: "a3", code: "log_unavailable" }])).toMatchObject({
      status: "incomplete",
      unavailable: [{ node: "a3", code: "log_unavailable" }],
    });
    expect(summarizeShareLog([{ ok: false, node: "a2", code: "unreachable" }]).status).toBe("error");
  });
});

describe("cpaDaysLeft", () => {
  it("counts down 45 days from confirmation and goes negative once overdue", () => {
    const confirmed = new Date("2026-10-01T12:00:00Z");
    expect(cpaDaysLeft(confirmed, new Date("2026-10-01T13:00:00Z"))).toBe(45);
    expect(cpaDaysLeft(confirmed, new Date("2026-11-15T12:00:00Z"))).toBe(0);
    expect(cpaDaysLeft(confirmed, new Date("2026-11-20T12:00:00Z"))).toBe(-5);
  });
});
