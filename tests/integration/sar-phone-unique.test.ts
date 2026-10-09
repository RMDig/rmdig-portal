import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// One verified phone per LIVE SAR org (migration 0025): rejected and withdrawn
// orgs are final, so they release their number and the applicant can apply
// again with it; pending, approved, leaving and suspended orgs keep holding it.
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

const dbName = `phone_it_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const admin = postgres(url, { max: 1, onnotice: () => {} });
const testUrl = Object.assign(new URL(url), { pathname: `/${dbName}` }).toString();
let sql: postgres.Sql;
let userId: string;

type Status = "pending" | "approved" | "rejected" | "suspended" | "leaving" | "withdrawn";

async function org(phone: string, status: Status): Promise<void> {
  await sql`INSERT INTO sar_orgs (name, contact_name, contact_email, operating_status, proof_doc_url, created_by_user_id, status, contact_phone)
            VALUES ('Test team', 'Lead', 'lead@sar.org', 'county_sar', 'blob://proof', ${userId}, ${status}, ${phone})`;
}

async function uniqueViolation(phone: string, status: Status): Promise<string | undefined> {
  try {
    await org(phone, status);
    return undefined;
  } catch (err) {
    return (err as { code?: string }).code;
  }
}

beforeAll(async () => {
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  sql = postgres(testUrl, { max: 2, onnotice: () => {} });
  await migrate(drizzle(sql), { migrationsFolder: "lib/db/migrations" });
  const [user] = await sql<{ id: string }[]>`INSERT INTO users (email) VALUES ('lead@sar.org') RETURNING id`;
  userId = user!.id;
}, 60_000);

afterAll(async () => {
  await sql?.end();
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe("SAR org phone uniqueness (Postgres)", () => {
  it("lets a rejected applicant apply again with the same number", async () => {
    await org("+17205550101", "rejected");
    expect(await uniqueViolation("+17205550101", "pending")).toBeUndefined();
  });

  it("still refuses a second live org on a number that's in use", async () => {
    expect(await uniqueViolation("+17205550101", "pending")).toBe("23505");
  });

  it("releases the number of a withdrawn org too", async () => {
    await org("+17205550102", "withdrawn");
    expect(await uniqueViolation("+17205550102", "approved")).toBeUndefined();
  });

  it("keeps the number held while an org is suspended or leaving", async () => {
    await org("+17205550103", "suspended");
    expect(await uniqueViolation("+17205550103", "pending")).toBe("23505");
    await org("+17205550104", "leaving");
    expect(await uniqueViolation("+17205550104", "pending")).toBe("23505");
  });

  it("allows any number of rejected orgs on one number", async () => {
    await org("+17205550105", "rejected");
    expect(await uniqueViolation("+17205550105", "rejected")).toBeUndefined();
  });
});
