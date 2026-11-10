import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Which live SAR teams have no admin (plan 33 §6.4, step 9.13), against every
// migration: a team whose only admin's account was deleted counts; rejected
// and withdrawn teams don't, nor does a team whose admin is still there.
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

const dbName = `noadmin_it_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const admin = postgres(url, { max: 1, onnotice: () => {} });
const testUrl = Object.assign(new URL(url), { pathname: `/${dbName}` }).toString();
let sql: postgres.Sql;
let noAdmin: typeof import("@/lib/sar/no-admin");
let creatorId: string;

async function user(email: string): Promise<string> {
  const [u] = await sql<{ id: string }[]>`INSERT INTO users (email) VALUES (${email}) RETURNING id`;
  return u!.id;
}

async function team(name: string, status: string, members: Array<[string, "admin" | "dispatcher" | "responder"]>): Promise<string> {
  const [o] = await sql<{ id: string }[]>`
    INSERT INTO sar_orgs (name, contact_name, contact_email, operating_status, proof_doc_url, created_by_user_id, status)
    VALUES (${name}, 'Lead', 'lead@sar.org', 'county_sar', 'blob://proof', ${creatorId}, ${status}::sar_org_status) RETURNING id`;
  for (const [userId, role] of members) {
    await sql`INSERT INTO org_memberships (org_id, user_id, role) VALUES (${o!.id}, ${userId}, ${role}::org_role)`;
  }
  return o!.id;
}

let alphaId: string;
let bravoId: string;

beforeAll(async () => {
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  sql = postgres(testUrl, { max: 2, onnotice: () => {} });
  await migrate(drizzle(sql), { migrationsFolder: "lib/db/migrations" });
  creatorId = await user("creator@rmdig.ai");
  const lead = await user("lead@alpha.org");
  const gone = await user("gone@bravo.org");
  const dispatcher = await user("dispatch@bravo.org");

  alphaId = await team("Alpha SAR", "approved", [[lead, "admin"]]);
  bravoId = await team("Bravo SAR", "approved", [[gone, "admin"], [dispatcher, "dispatcher"]]);
  await team("Charlie SAR", "suspended", [[dispatcher, "responder"]]);
  await team("Delta SAR", "rejected", []);
  await team("Echo SAR", "withdrawn", []);
  // Bravo's only admin deletes their account (memberships cascade).
  await sql`DELETE FROM users WHERE id = ${gone}`;

  process.env.DATABASE_URL = testUrl;
  noAdmin = await import("@/lib/sar/no-admin");
}, 60_000);

afterAll(async () => {
  await sql?.end();
  // lib/db holds its own connection; force it off so the drop succeeds.
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe("SAR teams with no admin (Postgres)", () => {
  it("lists live teams with no admin, including one whose admin deleted their account", async () => {
    const teams = await noAdmin.teamsWithoutAdmin();
    expect(teams.map((t) => [t.name, t.status])).toEqual([
      ["Bravo SAR", "approved"],
      ["Charlie SAR", "suspended"],
    ]);
  });

  it("tells one team's pages whether it has an admin", async () => {
    expect(await noAdmin.teamHasAdmin(alphaId)).toBe(true);
    expect(await noAdmin.teamHasAdmin(bravoId)).toBe(false);
  });
});
