import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The SAR team-email claim (lib/sar/alert-notify-store.ts) against real
// Postgres: the unit tests model its rules, this proves the SQL keeps them
// when both AvServ nodes' copies race. Also checks the evidence foreign keys
// (migration 0024): an org with history can't be deleted, and retention's
// delete of an alert's messages takes its email record with it. And the
// rmdig_sar_approver grant: 0024 runs over a database that already has staff
// (migrated to 0023 first), in one transaction as drizzle runs it, and makes
// every rmdig_admin, and nobody else, a SAR approver.
//
// Runs every migration into a fresh, throwaway database on the local server
// and drops it afterwards. Run:
// INTEGRATION_DATABASE_URL=postgresql://postgres:pw@127.0.0.1:55432/postgres pnpm test:integration

const url = process.env.INTEGRATION_DATABASE_URL;
if (!url) throw new Error("Set INTEGRATION_DATABASE_URL to a local PostGIS database.");
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") {
  throw new Error(`Refusing non-local INTEGRATION_DATABASE_URL host ${host}: integration tests never touch Neon.`);
}

const dbName = `notify_it_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const admin = postgres(url, { max: 1, onnotice: () => {} });
const testUrl = Object.assign(new URL(url), { pathname: `/${dbName}` }).toString();
let sql: postgres.Sql;
let store: typeof import("@/lib/sar/alert-notify-store");

const ORG = randomUUID();
const KEY = { orgId: ORG, alertId: "sub:team", kind: "overdue" };
const LEASE = 60_000;
const T0 = new Date("2026-10-07T10:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

beforeAll(async () => {
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  sql = postgres(testUrl, { max: 4, onnotice: () => {} });
  // Up to 0023 first, with staff in place, then 0024 the way a deploy runs it.
  const before = mkdtempSync(join(tmpdir(), "migrations-0023-"));
  cpSync("lib/db/migrations", before, { recursive: true });
  const journal = JSON.parse(readFileSync(join(before, "meta/_journal.json"), "utf8")) as { entries: Array<{ idx: number }> };
  journal.entries = journal.entries.filter((e) => e.idx < 24);
  writeFileSync(join(before, "meta/_journal.json"), JSON.stringify(journal));
  await migrate(drizzle(sql), { migrationsFolder: before });
  rmSync(before, { recursive: true, force: true });
  await sql`INSERT INTO users (email) VALUES ('admin@rmdig.ai'), ('reviewer@rmdig.ai')`;
  await sql`INSERT INTO user_platform_roles (user_id, role)
            SELECT id, (CASE email WHEN 'admin@rmdig.ai' THEN 'rmdig_admin' ELSE 'rmdig_reviewer' END)::platform_role FROM users`;
  await sql`INSERT INTO platform_role_log (action, role, target_email) VALUES ('granted', 'rmdig_admin', 'admin@rmdig.ai')`;
  await migrate(drizzle(sql), { migrationsFolder: "lib/db/migrations" });
  const [user] = await sql<{ id: string }[]>`INSERT INTO users (email) VALUES ('lead@sar.org') RETURNING id`;
  await sql`INSERT INTO sar_orgs (id, name, contact_name, contact_email, operating_status, proof_doc_url, created_by_user_id, status)
            VALUES (${ORG}, 'Summit SAR', 'Lead', 'lead@sar.org', 'county_sar', 'blob://proof', ${user!.id}, 'approved')`;
  for (const id of ["m-avserv-2", "m-avserv-3"]) {
    await sql`INSERT INTO sar_intake_messages (message_id, alert_id, org_id, kind, node, drill, sent_at, payload)
              VALUES (${id}, 'sub:team', ${ORG}, 'overdue', ${id.slice(2)}, false, now(), '{}'::jsonb)`;
  }
  process.env.DATABASE_URL = testUrl;
  store = await import("@/lib/sar/alert-notify-store");
}, 60_000);

afterAll(async () => {
  await sql?.end();
  // lib/db holds its own connection; force it off so the drop succeeds.
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe("SAR alert email claim (Postgres)", () => {
  it("gives the claim to exactly one of many simultaneous copies", async () => {
    const claims = await Promise.all(
      Array.from({ length: 8 }, (_, i) => store.claimNew(KEY, i % 2 ? "m-avserv-3" : "m-avserv-2", T0, LEASE)),
    );
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.find(Boolean)).toMatchObject({ attempts: 1, deliveredUserIds: [] });
  });

  it("won't let a retry take an attempt that still holds its lease", async () => {
    expect(await store.claimRetry(KEY, at(LEASE - 1), LEASE)).toBeNull();
    expect(await store.dueForRetry(at(LEASE - 1), 10)).toEqual([]);
  });

  it("gives an expired lease to exactly one retrier, and fences out the old attempt", async () => {
    expect(await store.dueForRetry(at(LEASE + 1), 10)).toEqual([KEY]);
    const retries = await Promise.all(Array.from({ length: 5 }, () => store.claimRetry(KEY, at(LEASE + 1), LEASE)));
    const won = retries.filter(Boolean);
    expect(won).toHaveLength(1);
    expect(won[0]).toMatchObject({ attempts: 2 });
    // The first attempt finishing late can't overwrite the second's result.
    const stale = { ...KEY, attempts: 1, deliveredUserIds: [] };
    expect(await store.recordAttempt(stale, { status: "sent", deliveredUserIds: [], lastError: null, now: at(LEASE + 2) })).toBe(false);
  });

  it("records a failure as owed, and a sent email as done for good", async () => {
    const userId = randomUUID();
    const claim = { ...KEY, attempts: 2, deliveredUserIds: [] };
    expect(await store.recordAttempt(claim, { status: "failed", deliveredUserIds: [userId], lastError: "resend down", now: at(LEASE + 3) })).toBe(true);
    expect(await store.dueForRetry(at(LEASE + 4), 10)).toEqual([KEY]);

    const third = await store.claimRetry(KEY, at(LEASE + 4), LEASE);
    expect(third).toMatchObject({ attempts: 3, deliveredUserIds: [userId] });
    expect(await store.recordAttempt(third!, { status: "sent", deliveredUserIds: [userId], lastError: null, now: at(LEASE + 5) })).toBe(true);
    expect(await store.claimRetry(KEY, at(10 * LEASE), LEASE)).toBeNull();
    expect(await store.dueForRetry(at(10 * LEASE), 10)).toEqual([]);
    const [row] = await sql`SELECT status, sent_at, leased_until FROM sar_alert_notifications WHERE org_id = ${ORG}`;
    expect(row).toMatchObject({ status: "sent", leased_until: null });
    expect(row!.sent_at).not.toBeNull();
  });

  it("reads the team name and the claiming message's capability", async () => {
    expect(await store.notifyContext(KEY)).toEqual({ teamName: "Summit SAR", capability: null });
  });

  it("restricts deleting an org that has alerts or history", async () => {
    await expect(sql`DELETE FROM sar_orgs WHERE id = ${ORG}`).rejects.toMatchObject({ code: "23503" });
  });

  it("drops the email record with the alert's messages (retention)", async () => {
    await sql`DELETE FROM sar_intake_messages WHERE org_id = ${ORG}`;
    const rows = await sql`SELECT 1 FROM sar_alert_notifications WHERE org_id = ${ORG}`;
    expect(rows).toHaveLength(0);
  });

  it("made every rmdig_admin, and only them, a SAR approver, logged with no actor", async () => {
    const roles = await sql<{ email: string; role: string }[]>`
      SELECT u.email, r.role::text AS role FROM user_platform_roles r JOIN users u ON u.id = r.user_id ORDER BY u.email, r.role`;
    expect(roles).toEqual([
      { email: "admin@rmdig.ai", role: "rmdig_admin" },
      { email: "admin@rmdig.ai", role: "rmdig_sar_approver" },
      { email: "reviewer@rmdig.ai", role: "rmdig_reviewer" },
    ]);
    const log = await sql`SELECT action::text, role::text, target_email, actor_user_id FROM platform_role_log ORDER BY created_at, role`;
    expect(log).toContainEqual({ action: "granted", role: "rmdig_sar_approver", target_email: "admin@rmdig.ai", actor_user_id: null });
    expect(log).toHaveLength(2);
    const [t] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_type WHERE typname = 'platform_role_before_0024'`;
    expect(t!.n).toBe(0);
  });
});
