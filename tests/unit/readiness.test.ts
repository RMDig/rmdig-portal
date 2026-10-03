import { beforeEach, describe, expect, it, vi } from "vitest";

import { evaluateReadiness } from "@/lib/health/readiness";

// /readyz must fail whenever production can't serve signed-in pages: the
// database is unreachable, or it lacks the schema this build expects (both
// 2026-10 outages). /healthz never could see either.

const journal = [
  { idx: 0, when: 100, tag: "0000_a" },
  { idx: 1, when: 200, tag: "0001_b" },
];

describe("evaluateReadiness", () => {
  it("is ready when every shipped migration is applied", () => {
    expect(evaluateReadiness(journal, [100, 200])).toEqual({
      status: "ready",
      checks: { database: "ok", schema: "ok" },
    });
  });

  it("stays ready when production is migrated ahead of this deploy", () => {
    expect(evaluateReadiness(journal, [100, 200, 300]).status).toBe("ready");
  });

  it("is unready when the database lacks a shipped migration", () => {
    expect(evaluateReadiness(journal, [100])).toEqual({
      status: "unready",
      checks: { database: "ok", schema: "behind" },
    });
  });

  it("is unready on an empty database (the 2026-10-02 re-pin outage)", () => {
    expect(evaluateReadiness(journal, []).checks.schema).toBe("behind");
  });

  it("reports a reachable database with no schema (wrong database URL), even when wrapped", () => {
    const pgError = Object.assign(new Error('relation "drizzle.__drizzle_migrations" does not exist'), {
      code: "42P01",
    });
    const wrapped = Object.assign(new Error("Failed query"), { cause: pgError });
    for (const err of [pgError, wrapped]) {
      expect(evaluateReadiness(journal, err)).toEqual({
        status: "unready",
        checks: { database: "ok", schema: "behind" },
      });
    }
  });

  it("is unready when the database can't be reached", () => {
    expect(evaluateReadiness(journal, Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }))).toEqual({
      status: "unready",
      checks: { database: "unreachable", schema: "unknown" },
    });
  });
});

const h = vi.hoisted(() => ({
  execute: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: { execute: h.execute } }));
vi.mock("@/lib/env", () => ({ env: { VERCEL_GIT_COMMIT_SHA: "abc123" } }));
vi.mock("@/lib/logger", () => ({ logger: { error: h.error, info: vi.fn(), warn: vi.fn() } }));
vi.mock("@/lib/db/migrations/meta/_journal.json", () => ({
  default: { entries: [{ idx: 0, when: 100, tag: "0000_a" }] },
}));

import { GET } from "@/app/readyz/route";

describe("GET /readyz", () => {
  beforeEach(() => vi.clearAllMocks());

  it("answers 200 with no-store when ready", async () => {
    h.execute.mockResolvedValue([{ created_at: "100" }]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({
      status: "ready",
      checks: { database: "ok", schema: "ok" },
      commit: "abc123",
    });
  });

  it("answers 503 and logs loudly when the schema is missing, without leaking detail", async () => {
    h.execute.mockRejectedValue(new Error('relation "drizzle.__drizzle_migrations" does not exist'));
    const res = await GET();
    expect(res.status).toBe(503);
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain("relation");
    expect(h.error).toHaveBeenCalledWith(expect.objectContaining({ event: "readyz.database_unreadable" }));
  });

  it("answers 503 when a shipped migration isn't applied", async () => {
    h.execute.mockResolvedValue([]);
    const res = await GET();
    expect(res.status).toBe(503);
    expect(h.error).toHaveBeenCalledWith({ event: "readyz.schema_behind" });
  });
});
