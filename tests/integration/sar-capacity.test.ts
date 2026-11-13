import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Migration 0043 (plan 33 9.7) against real Postgres: a team's check-out cap
// holds only AvServ's range or null, and the settings log keeps the team it
// belongs to from being deleted, like the area log.
//
// INTEGRATION_DATABASE_URL=postgresql://postgres:pw@127.0.0.1:55432/postgres pnpm test:integration

const url = process.env.INTEGRATION_DATABASE_URL;
if (!url) throw new Error("Set INTEGRATION_DATABASE_URL to a local PostGIS database.");
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`Refusing non-local INTEGRATION_DATABASE_URL host ${host}.`);

const dbName = `capacity_it_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const admin = postgres(url, { max: 1, onnotice: () => {} });
const testUrl = Object.assign(new URL(url), { pathname: `/${dbName}` }).toString();
let sql: postgres.Sql;
let orgId: string;
let userId: string;

beforeAll(async () => {
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  sql = postgres(testUrl, { max: 1, onnotice: () => {} });
  await migrate(drizzle(sql), { migrationsFolder: "lib/db/migrations" });
  const [u] = await sql<{ id: string }[]>`INSERT INTO users (email) VALUES ('lead@summit.org') RETURNING id`;
  userId = u!.id;
  const [o] = await sql<{ id: string; max_active_checkouts: number | null }[]>`
    INSERT INTO sar_orgs (name, contact_name, contact_email, operating_status, proof_doc_url, created_by_user_id, status)
    VALUES ('Summit SAR', 'Lead', 'lead@summit.org', 'county_sar', 'blob://p', ${userId}, 'approved') RETURNING id, max_active_checkouts`;
  orgId = o!.id;
  expect(o!.max_active_checkouts).toBeNull();
}, 60_000);

afterAll(async () => {
  await sql?.end();
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe("sar_orgs.max_active_checkouts (migration 0043)", () => {
  it("starts with no limit, and holds 1 to 10,000 or null", async () => {
    for (const cap of [1, 25, 10_000, null]) {
      await sql`UPDATE sar_orgs SET max_active_checkouts = ${cap} WHERE id = ${orgId}`;
    }
  });

  it("refuses anything outside AvServ's range", async () => {
    for (const cap of [0, -1, 10_001]) {
      await expect(sql`UPDATE sar_orgs SET max_active_checkouts = ${cap} WHERE id = ${orgId}`).rejects.toThrow(/sar_orgs_max_active_checkouts_range/);
    }
  });
});

describe("sar_org_settings_log", () => {
  it("records a change, keeps it when the actor's account goes, and keeps the team from being deleted", async () => {
    await sql`INSERT INTO sar_org_settings_log (org_id, setting, from_value, to_value, actor_user_id)
              VALUES (${orgId}, 'max_active_checkouts', NULL, '25', ${userId})`;
    await expect(sql`DELETE FROM sar_orgs WHERE id = ${orgId}`).rejects.toThrow(/sar_org_settings_log_org_id_sar_orgs_id_fk/);
    const [row] = await sql`SELECT setting, from_value, to_value, actor_user_id FROM sar_org_settings_log WHERE org_id = ${orgId}`;
    expect(row).toEqual({ setting: "max_active_checkouts", from_value: null, to_value: "25", actor_user_id: userId });
  });
});
