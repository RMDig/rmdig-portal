import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Migration 0038 (plan 33 9.10): a team's on-call address and its
// confirmation time are set together or not at all, and a confirmation
// link's token hash is unique.
//
// INTEGRATION_DATABASE_URL=postgresql://postgres:pw@127.0.0.1:55432/postgres pnpm test:integration

const url = process.env.INTEGRATION_DATABASE_URL;
if (!url) throw new Error("Set INTEGRATION_DATABASE_URL to a local PostGIS database.");
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`Refusing non-local INTEGRATION_DATABASE_URL host ${host}.`);

const dbName = `oncall_it_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const admin = postgres(url, { max: 1, onnotice: () => {} });
const testUrl = Object.assign(new URL(url), { pathname: `/${dbName}` }).toString();
let sql: postgres.Sql;
let orgId: string;

beforeAll(async () => {
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  sql = postgres(testUrl, { max: 2, onnotice: () => {} });
  await migrate(drizzle(sql), { migrationsFolder: "lib/db/migrations" });
  const [u] = await sql<{ id: string }[]>`INSERT INTO users (email) VALUES ('lead@summit.org') RETURNING id`;
  const [o] = await sql<{ id: string }[]>`
    INSERT INTO sar_orgs (name, contact_name, contact_email, operating_status, proof_doc_url, created_by_user_id, status)
    VALUES ('Summit SAR', 'Lead', 'lead@summit.org', 'county_sar', 'blob://proof', ${u!.id}, 'approved') RETURNING id`;
  orgId = o!.id;
}, 60_000);

afterAll(async () => {
  await sql?.end();
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe("on-call email (migration 0038)", () => {
  it("sets the address and its confirmation together, never one alone", async () => {
    await sql`UPDATE sar_orgs SET oncall_email = 'dispatch@summit.org', oncall_email_verified_at = now() WHERE id = ${orgId}`;
    await expect(sql`UPDATE sar_orgs SET oncall_email_verified_at = NULL WHERE id = ${orgId}`).rejects.toThrow(/sar_orgs_oncall_email_verified/);
    await expect(sql`UPDATE sar_orgs SET oncall_email = NULL WHERE id = ${orgId}`).rejects.toThrow(/sar_orgs_oncall_email_verified/);
  });

  it("keeps each link's token hash unique", async () => {
    const insert = () => sql`
      INSERT INTO sar_oncall_email_verifications (org_id, address, token_hash, expires)
      VALUES (${orgId}, 'new@summit.org', ${"c".repeat(64)}, now() + interval '1 day')`;
    await insert();
    await expect(insert()).rejects.toThrow(/token_hash_unique/);
  });
});
