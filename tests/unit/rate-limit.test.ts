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

import { incrementRateLimit, MAX_RATE_LIMIT_WINDOW_SEC, peekRateLimit, storedKey } from "@/lib/rate-limit";

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

describe("storedKey (plan 36 H6)", () => {
  it("keeps the bucket's prefix and hashes what identifies a person", () => {
    const k = storedKey("signin:pat@example.org:203.0.113.7");
    expect(k).toMatch(/^signin:[0-9a-f]{32}$/);
    expect(k).not.toContain("example.org");
    expect(storedKey("otp-phone:+17205550123")).not.toContain("5550123");
  });

  it("is stable, distinct per key, and leaves a bare prefix alone", () => {
    expect(storedKey("signin-ip:203.0.113.7")).toBe(storedKey("signin-ip:203.0.113.7"));
    expect(storedKey("signin-ip:203.0.113.7")).not.toBe(storedKey("signin-ip:203.0.113.8"));
    expect(storedKey("global")).toBe("global");
  });
});

describe("window cap", () => {
  // The daily cleanup deletes windows older than its grace period, so a longer
  // window must fail loudly rather than be reset early without anyone knowing.
  it("refuses a window longer than MAX_RATE_LIMIT_WINDOW_SEC, before touching the DB", async () => {
    const opts = { limit: 3, windowSec: MAX_RATE_LIMIT_WINDOW_SEC + 1 };
    await expect(incrementRateLimit("k", opts)).rejects.toThrow(/exceeds MAX_RATE_LIMIT_WINDOW_SEC/);
    await expect(peekRateLimit("k", opts)).rejects.toThrow(/exceeds MAX_RATE_LIMIT_WINDOW_SEC/);
    expect(h.executes).toBe(0);
  });
});
