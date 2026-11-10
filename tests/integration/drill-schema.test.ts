import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DRILL_EMAIL_PATTERN } from "@/lib/db/schema";

// Drill teams and drill logins (migration 0036, plan 37 §4.1–§4.2). The
// database itself enforces the rules: the drill flag never changes, drill and
// real never mix, a drill team has the shape AvServ accepts, and a drill login
// has an address the operator reads.
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

const dbName = `drill_it_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const admin = postgres(url, { max: 1, onnotice: () => {} });
const testUrl = Object.assign(new URL(url), { pathname: `/${dbName}` }).toString();
let sql: postgres.Sql;
let staffId: string;

type Org = { name?: string; isDrill: boolean; proof?: string | null; orgType?: "sar_team" | "ski_patrol" };

async function org({ name, isDrill, proof, orgType = "sar_team" }: Org): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO sar_orgs (name, contact_name, contact_email, operating_status, proof_doc_url, created_by_user_id, org_type, is_drill)
    VALUES (${name ?? (isDrill ? "AvAI Drill Team" : "San Juan SAR")}, 'Lead', 'lead@sar.org', 'county_sar',
            ${proof === undefined ? (isDrill ? null : "blob://proof") : proof}, ${staffId}, ${orgType}, ${isDrill})
    RETURNING id`;
  return row!.id;
}

async function user(email: string, isDrill: boolean): Promise<string> {
  const [row] = await sql<{ id: string }[]>`INSERT INTO users (email, is_drill) VALUES (${email}, ${isDrill}) RETURNING id`;
  return row!.id;
}

// The SQLSTATE a statement fails with, or undefined if it succeeds.
async function code(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
    return undefined;
  } catch (err) {
    return (err as { code?: string }).code;
  }
}

const CHECK_VIOLATION = "23514";

beforeAll(async () => {
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  sql = postgres(testUrl, { max: 2, onnotice: () => {} });
  await migrate(drizzle(sql), { migrationsFolder: "lib/db/migrations" });
  staffId = await user("staff@rmdig.ai", false);
}, 60_000);

afterAll(async () => {
  await sql?.end();
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe("drill teams (Postgres)", () => {
  it("defaults every team to real, and a real team still needs a proof document", async () => {
    const id = await org({ isDrill: false });
    const [row] = await sql<{ is_drill: boolean }[]>`SELECT is_drill FROM sar_orgs WHERE id = ${id}`;
    expect(row!.is_drill).toBe(false);
    expect(await code(() => org({ isDrill: false, proof: null }))).toBe(CHECK_VIOLATION);
  });

  it("lets a drill team exist without a proof document", async () => {
    expect(await code(() => org({ isDrill: true }))).toBeUndefined();
  });

  it("refuses a drill team without 'drill' in its name, or that isn't a SAR team", async () => {
    expect(await code(() => org({ isDrill: true, name: "Test Team" }))).toBe(CHECK_VIOLATION);
    expect(await code(() => org({ isDrill: true, name: "Patrol DRILL", orgType: "ski_patrol" }))).toBe(CHECK_VIOLATION);
    expect(await code(() => org({ isDrill: true, name: "Capitol DRILL team" }))).toBeUndefined();
  });

  it("never lets a team's drill flag change, either way", async () => {
    const real = await org({ isDrill: false });
    const drill = await org({ isDrill: true });
    expect(await code(() => sql`UPDATE sar_orgs SET is_drill = true WHERE id = ${real}`)).toBe(CHECK_VIOLATION);
    expect(await code(() => sql`UPDATE sar_orgs SET is_drill = false WHERE id = ${drill}`)).toBe(CHECK_VIOLATION);
    // Every other column still updates as before.
    expect(await code(() => sql`UPDATE sar_orgs SET status = 'approved' WHERE id = ${drill}`)).toBeUndefined();
  });

  it("records the drill status-log actions", async () => {
    const drill = await org({ isDrill: true });
    for (const action of ["drill_registered", "drill_activated"]) {
      expect(
        await code(() => sql`INSERT INTO sar_org_status_log (org_id, action, to_status, actor_user_id)
                             VALUES (${drill}, ${action}, 'pending', ${staffId})`),
      ).toBeUndefined();
    }
  });
});

describe("drill logins (Postgres)", () => {
  // Each address, and whether a drill login may use it. The database must
  // agree with DRILL_EMAIL_PATTERN, which the forms use to refuse it first.
  const addresses: [string, boolean][] = [
    ["ops+drill1@rmdig.ai", true],
    ["ops+drill@rmdig.ai", true],
    ["Ops+Drill-Admin@RMDig.ai", true],
    ["ops@rmdig.ai", false],
    ["ops+test@rmdig.ai", false],
    ["ops+drill1@gmail.com", false],
    ["ops+drill1@rmdig.ai.evil.com", false],
    ["ops+drill1@rmdigxai", false],
  ];

  it.each(addresses)("%s: a drill login may use it = %s, in the database and in the shared pattern", async (email, ok) => {
    expect(new RegExp(DRILL_EMAIL_PATTERN).test(email.toLowerCase())).toBe(ok);
    expect(await code(() => user(email, true))).toBe(ok ? undefined : CHECK_VIOLATION);
  });

  it("puts no limit on a real user's address", async () => {
    expect(await code(() => user("someone@gmail.com", false))).toBeUndefined();
  });

  it("never lets a user's drill flag change, either way", async () => {
    const real = await user("real-flip@example.org", false);
    const drill = await user("ops+drill-flip@rmdig.ai", true);
    expect(await code(() => sql`UPDATE users SET is_drill = true WHERE id = ${real}`)).toBe(CHECK_VIOLATION);
    expect(await code(() => sql`UPDATE users SET is_drill = false WHERE id = ${drill}`)).toBe(CHECK_VIOLATION);
    expect(await code(() => sql`UPDATE users SET name = 'Drill admin' WHERE id = ${drill}`)).toBeUndefined();
  });

  it("lets a drill user join only drill teams, and a drill team accept only drill users", async () => {
    const realOrg = await org({ isDrill: false });
    const drillOrg = await org({ isDrill: true });
    const realUser = await user("member@sar.org", false);
    const drillUser = await user("ops+drill-member@rmdig.ai", true);
    const join = (orgId: string, userId: string) =>
      code(() => sql`INSERT INTO org_memberships (org_id, user_id, role) VALUES (${orgId}, ${userId}, 'admin')`);
    expect(await join(realOrg, drillUser)).toBe(CHECK_VIOLATION);
    expect(await join(drillOrg, realUser)).toBe(CHECK_VIOLATION);
    expect(await join(drillOrg, drillUser)).toBeUndefined();
    expect(await join(realOrg, realUser)).toBeUndefined();
    // Moving a membership across the line is refused the same way.
    expect(
      await code(() => sql`UPDATE org_memberships SET org_id = ${realOrg} WHERE org_id = ${drillOrg} AND user_id = ${drillUser}`),
    ).toBe(CHECK_VIOLATION);
    // A role change inside the same team is unaffected.
    expect(
      await code(() => sql`UPDATE org_memberships SET role = 'dispatcher' WHERE org_id = ${drillOrg} AND user_id = ${drillUser}`),
    ).toBeUndefined();
  });

  it("never gives a drill user a platform role", async () => {
    const drillUser = await user("ops+drill-staff@rmdig.ai", true);
    for (const role of ["rmdig_admin", "rmdig_reviewer", "rmdig_sar_approver"]) {
      expect(await code(() => sql`INSERT INTO user_platform_roles (user_id, role) VALUES (${drillUser}, ${role})`)).toBe(
        CHECK_VIOLATION,
      );
    }
    expect(await code(() => sql`INSERT INTO user_platform_roles (user_id, role) VALUES (${staffId}, 'rmdig_admin')`)).toBeUndefined();
  });
});
