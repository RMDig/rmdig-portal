import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/rate-limit's read-only peek (used for failure-only limits). The SQL itself
// runs against Postgres; here we pin how its rows map to a decision.

const h = vi.hoisted(() => ({ rows: [] as Array<{ attempts: number; window_start: string | Date }>, executes: 0 }));

vi.mock("@/lib/db", () => ({
  db: {
    execute: () => {
      h.executes++;
      return Promise.resolve(h.rows);
    },
  },
}));

import { incrementRateLimit, peekRateLimit } from "@/lib/rate-limit";

const OPTS = { limit: 3, windowSec: 60 };

beforeEach(() => {
  h.rows = [];
  h.executes = 0;
});

describe("peekRateLimit", () => {
  it("reads no row (or an expired window) as zero attempts, allowed", async () => {
    await expect(peekRateLimit("k", OPTS)).resolves.toMatchObject({ allowed: true, attempts: 0 });
  });

  it("allows while attempts are below the limit, so the next increment is still within it", async () => {
    h.rows = [{ attempts: 2, window_start: new Date() }];
    await expect(peekRateLimit("k", OPTS)).resolves.toMatchObject({ allowed: true, attempts: 2 });
  });

  it("blocks once attempts reach the limit, and reports when the window resets", async () => {
    const start = new Date("2026-10-07T12:00:00Z");
    h.rows = [{ attempts: 3, window_start: start.toISOString() }];
    const res = await peekRateLimit("k", OPTS);
    expect(res.allowed).toBe(false);
    expect(res.resetAt.toISOString()).toBe("2026-10-07T12:01:00.000Z");
  });

  it("agrees with incrementRateLimit at the boundary: the limit-th attempt is allowed, then peek blocks", async () => {
    h.rows = [{ attempts: 3, window_start: new Date() }];
    await expect(incrementRateLimit("k", OPTS)).resolves.toMatchObject({ allowed: true });
    await expect(peekRateLimit("k", OPTS)).resolves.toMatchObject({ allowed: false });
  });
});
