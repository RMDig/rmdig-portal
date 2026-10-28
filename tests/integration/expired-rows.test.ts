import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/lib/db/schema";

// The daily cleanup's deletes against the real schema: what goes, and what
// stays (live sessions, tokens in their grace period, confirmed deletion
// requests, a window still counting).
//
// INTEGRATION_DATABASE_URL=postgresql://postgres:pw@127.0.0.1:55432/postgres pnpm test:integration

const url = process.env.INTEGRATION_DATABASE_URL;
if (!url) throw new Error("Set INTEGRATION_DATABASE_URL to a local PostGIS database.");
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") {
  throw new Error(`Refusing non-local INTEGRATION_DATABASE_URL host ${host}: integration tests never touch Neon.`);
}

const h = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/lib/db", () => ({
  get db() {
    return h.db;
  },
}));

import { deleteExpiredRows } from "@/lib/retention/expired-rows";

const dbName = `expired_it_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const admin = postgres(url, { max: 1, onnotice: () => {} });
const testUrl = Object.assign(new URL(url), { pathname: `/${dbName}` }).toString();
let sql: postgres.Sql;

const NOW = new Date("2026-10-27T10:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

beforeAll(async () => {
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  sql = postgres(testUrl, { max: 2, onnotice: () => {} });
  await migrate(drizzle(sql), { migrationsFolder: "lib/db/migrations" });
  h.db = drizzle(sql, { schema });

  const [user] = await sql<{ id: string }[]>`INSERT INTO users (email) VALUES ('e@example.com') RETURNING id`;
  const uid = user!.id;
  await sql`INSERT INTO sessions ("sessionToken", "userId", expires) VALUES
    ('dead', ${uid}, ${ago(1)}), ('live', ${uid}, ${ago(-1)})`;
  await sql`INSERT INTO password_reset_tokens (user_id, token_hash, expires) VALUES
    (${uid}, 'r-old', ${ago(8)}), (${uid}, 'r-grace', ${ago(6)})`;
  await sql`INSERT INTO verification_tokens (identifier, token, expires) VALUES
    ('e@example.com', 'v-old', ${ago(8)}), ('e@example.com', 'v-grace', ${ago(6)})`;
  await sql`INSERT INTO deletion_requests (email, token_hash, token_expires_at, status, confirmed_at) VALUES
    ('a@example.com', 'd-pending-old', ${ago(8)}, 'pending_confirmation', NULL),
    ('b@example.com', 'd-pending-grace', ${ago(6)}, 'pending_confirmation', NULL),
    ('c@example.com', 'd-confirmed', ${ago(60)}, 'confirmed', ${ago(59)})`;
  const [org] = await sql<{ id: string }[]>`INSERT INTO sar_orgs (name, contact_name, contact_email, operating_status, proof_doc_url, created_by_user_id)
    VALUES ('Team', 'C', 'c@example.com', 'volunteer_group', 'https://example.com/p', ${uid}) RETURNING id`;
  await sql`INSERT INTO org_invitations (org_id, email, role, token_hash, expires_at, accepted_at, created_by_user_id) VALUES
    (${org!.id}, 'i1@example.com', 'responder', 'i-old', ${ago(8)}, NULL, ${uid}),
    (${org!.id}, 'i2@example.com', 'responder', 'i-grace', ${ago(6)}, NULL, ${uid}),
    (${org!.id}, 'i3@example.com', 'responder', 'i-accepted', ${ago(30)}, ${ago(40)}, ${uid})`;
  await sql`INSERT INTO platform_role_invitations (email, role, token_hash, expires_at, created_by_user_id) VALUES
    ('s@example.com', 'rmdig_reviewer', 'p-old', ${ago(8)}, ${uid})`;
  await sql`INSERT INTO rate_limits (key, attempts, window_start) VALUES
    ('old', 3, ${ago(8)}), ('counting', 1, ${ago(0.5)})`;
});

afterAll(async () => {
  await sql?.end();
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe("deleteExpiredRows (real schema)", () => {
  it("deletes rows past use and keeps everything else", async () => {
    expect(await deleteExpiredRows(NOW)).toEqual({
      sessions: 1,
      passwordResetTokens: 1,
      verificationTokens: 1,
      unconfirmedDeletionRequests: 1,
      unacceptedInvitations: 2,
      rateLimits: 1,
    });
    expect((await sql`SELECT "sessionToken" FROM sessions`).map((r) => r.sessionToken)).toEqual(["live"]);
    expect((await sql`SELECT token_hash FROM password_reset_tokens`).map((r) => r.token_hash)).toEqual(["r-grace"]);
    expect((await sql`SELECT token FROM verification_tokens`).map((r) => r.token)).toEqual(["v-grace"]);
    expect((await sql`SELECT token_hash FROM deletion_requests ORDER BY token_hash`).map((r) => r.token_hash)).toEqual([
      "d-confirmed",
      "d-pending-grace",
    ]);
    expect((await sql`SELECT token_hash FROM org_invitations ORDER BY token_hash`).map((r) => r.token_hash)).toEqual([
      "i-accepted",
      "i-grace",
    ]);
    expect(await sql`SELECT 1 FROM platform_role_invitations`).toHaveLength(0);
    expect((await sql`SELECT key FROM rate_limits`).map((r) => r.key)).toEqual(["counting"]);
  });
});
