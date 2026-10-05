import { beforeEach, describe, expect, it, vi } from "vitest";

// The retention run's bookkeeping (the SQL itself is exercised against a real
// PostGIS: see the PR's test plan). Counts come from RETURNING rows; a stale
// open alert is kept and logged loudly.

const h = vi.hoisted(() => ({ results: [] as unknown[][], sqls: [] as string[], log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("@/lib/db", () => {
  const tx = {
    execute: (q: { queryChunks?: unknown[] }) => {
      h.sqls.push(JSON.stringify(q));
      return Promise.resolve(h.results.shift() ?? []);
    },
  };
  return { db: { transaction: (cb: (t: typeof tx) => unknown) => Promise.resolve(cb(tx)) } };
});

import { runSarRetention } from "@/lib/sar/retention";

beforeEach(() => {
  vi.clearAllMocks();
  h.sqls = [];
});

describe("runSarRetention", () => {
  it("counts what each step removed, in one transaction", async () => {
    // positions, acks, messages, alert views, map views, stale count
    h.results = [[1, 1], [1], [1, 1, 1], [1], [1, 1], [{ n: 0 }]];
    expect(await runSarRetention(new Date("2026-10-05T12:00:00Z"))).toEqual({
      positionsRemoved: 2,
      acksDeleted: 1,
      alertMessagesDeleted: 3,
      viewLogsDeleted: 3,
      staleOpenAlerts: 0,
    });
    expect(h.sqls).toHaveLength(6);
    expect(h.log.error).not.toHaveBeenCalled();
  });

  it("binds the cut-offs as ISO timestamps (the driver takes no Date parameters)", async () => {
    h.results = [[], [], [], [], [], [{ n: 0 }]];
    await runSarRetention(new Date("2026-10-05T12:00:00Z"));
    const all = h.sqls.join("\n");
    expect(all).toContain("2026-10-04T12:00:00.000Z"); // 24 h
    expect(all).toContain("2026-07-07T12:00:00.000Z"); // 90 days
    expect(all).toContain("2025-10-05T12:00:00.000Z"); // 365 days
  });

  it("keeps an alert that never ended, but logs it loudly after 30 days", async () => {
    h.results = [[], [], [], [], [], [{ n: 2 }]];
    expect((await runSarRetention(new Date())).staleOpenAlerts).toBe(2);
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "sar.retention.stale_open_alerts", count: 2 }));
  });
});
