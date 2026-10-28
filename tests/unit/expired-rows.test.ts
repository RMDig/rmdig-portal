import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The daily cleanup of rows past use (lib/retention/expired-rows.ts): which
// tables, which cut-offs, and that a confirmed deletion request is never one.

const h = vi.hoisted(() => ({
  deletes: [] as Array<{ table: string; where: SQL }>,
  rows: {} as Record<string, unknown[]>,
}));

vi.mock("@/lib/db", async () => {
  const { getTableName } = await import("drizzle-orm");
  const tx = {
    delete: (table: Parameters<typeof getTableName>[0]) => ({
      where: (where: SQL) => {
        const name = getTableName(table);
        h.deletes.push({ table: name, where });
        return { returning: async () => h.rows[name] ?? [] };
      },
    }),
  };
  return { db: { transaction: (cb: (t: typeof tx) => unknown) => Promise.resolve(cb(tx)) } };
});

import { deleteExpiredRows, GRACE_DAYS } from "@/lib/retention/expired-rows";
import { MAX_RATE_LIMIT_WINDOW_SEC } from "@/lib/rate-limit";

const NOW = new Date("2026-10-27T10:00:00Z");
const dialect = new PgDialect();
const query = (table: string) => {
  const d = h.deletes.find((x) => x.table === table);
  if (!d) throw new Error(`no delete on ${table}`);
  return dialect.sqlToQuery(d.where);
};

beforeEach(() => {
  h.deletes = [];
  h.rows = {};
});

describe("deleteExpiredRows", () => {
  it("counts what it deleted from each table, in one transaction", async () => {
    h.rows = { sessions: [{}, {}], password_reset_tokens: [{}], verification_tokens: [], deletion_requests: [{}], rate_limits: [{}, {}, {}] };
    expect(await deleteExpiredRows(NOW)).toEqual({
      sessions: 2,
      passwordResetTokens: 1,
      verificationTokens: 0,
      unconfirmedDeletionRequests: 1,
      rateLimits: 3,
    });
  });

  it("deletes sessions at expiry, and tokens and rate-limit windows after the grace period", async () => {
    await deleteExpiredRows(NOW);
    // Drizzle binds timestamps as ISO strings.
    const at = (table: string) => query(table).params.map((p) => new Date(p as string).toISOString());
    const graceCut = new Date(NOW.getTime() - GRACE_DAYS * 86_400_000).toISOString();
    expect(at("sessions")).toEqual([NOW.toISOString()]);
    expect(at("password_reset_tokens")).toEqual([graceCut]);
    expect(at("verification_tokens")).toEqual([graceCut]);
    expect(at("rate_limits")).toEqual([graceCut]);
  });

  it("deletes only unconfirmed deletion requests: a confirmed one is the CPA record", async () => {
    await deleteExpiredRows(NOW);
    const q = query("deletion_requests");
    expect(q.sql).toMatch(/"status" = \$1 and "deletion_requests"\."token_expires_at" < \$2/);
    expect(q.params[0]).toBe("pending_confirmation");
  });

  it("never deletes a rate-limit window that could still be counting", () => {
    expect(GRACE_DAYS * 86_400).toBeGreaterThanOrEqual(MAX_RATE_LIMIT_WINDOW_SEC);
  });
});
