import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { owedResyncs, type SyncRow } from "@/lib/sar/node-check";

// Which teams the 5-minute node check sends again (lib/sar/node-check.ts;
// plan 33 9.11). Its run is tested against Postgres in
// tests/integration/sar-node-check.test.ts.

const NODES = ["avserv-2", "avserv-3"];
const t = (min: number) => new Date(Date.UTC(2026, 10, 11, 12, min));
const row = (orgId: string, node: string, o: Partial<SyncRow> = {}): SyncRow => ({
  orgId,
  node,
  outcome: "ok",
  errorCode: null,
  remedy: null,
  attemptedAt: t(0),
  syncedAt: t(0),
  ...o,
});

describe("owedResyncs", () => {
  it("owes nothing while every node holds the team", () => {
    expect(owedResyncs([row("a", "avserv-2"), row("a", "avserv-3")], NODES)).toEqual([]);
  });

  it("owes a team a node failed, or a node asked for again (remedy resync)", () => {
    const rows = [
      row("a", "avserv-2"),
      row("a", "avserv-3", { outcome: "error", errorCode: "timeout" }),
      row("b", "avserv-2", { remedy: "resync" }),
      row("b", "avserv-3"),
      row("c", "avserv-2", { remedy: "reverify_channel" }),
      row("c", "avserv-3"),
    ];
    expect(owedResyncs(rows, NODES).sort()).toEqual(["a", "b"]);
  });

  it("never retries a drill refusal: a person looks at it", () => {
    const rows = [row("a", "avserv-2"), row("a", "avserv-3", { outcome: "error", errorCode: "sar_team_drill_immutable" })];
    expect(owedResyncs(rows, NODES)).toEqual([]);
    expect(owedResyncs([row("b", "avserv-2"), row("b", "avserv-3", { outcome: "error", errorCode: "drill_team_invalid" })], NODES)).toEqual([]);
  });

  it("sends a team to a node added since, but not one that was never sent anywhere", () => {
    expect(owedResyncs([row("a", "avserv-2"), row("a", "avserv-3")], [...NODES, "avserv-1"])).toEqual(["a"]);
    const skipped = [row("p", "avserv-2", { outcome: "skipped" }), row("p", "avserv-3", { outcome: "skipped" })];
    expect(owedResyncs(skipped, [...NODES, "avserv-1"])).toEqual([]);
  });

  it("ignores a node no longer configured, and puts the longest-waiting team first", () => {
    expect(owedResyncs([row("a", "avserv-2"), row("a", "avserv-3"), row("a", "avserv-9", { outcome: "error", errorCode: "timeout" })], NODES)).toEqual([]);
    const rows = [
      row("late", "avserv-2"),
      row("late", "avserv-3", { outcome: "error", errorCode: "http_502", attemptedAt: t(30) }),
      row("early", "avserv-2", { outcome: "error", errorCode: "timeout", attemptedAt: t(5) }),
      row("early", "avserv-3"),
    ];
    expect(owedResyncs(rows, NODES)).toEqual(["early", "late"]);
  });
});
