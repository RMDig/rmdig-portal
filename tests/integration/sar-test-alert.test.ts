import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// A team's test alert (lib/sar/test-alert.ts; migration 0040) against real
// Postgres: a node's answer is stored with its code hashed, a message can be
// marked received only once it's at the intake, and the code's guesses are
// capped under a row lock. Sent through a mock:// node, which answers with
// the mock code and sends nothing.
//
// INTEGRATION_DATABASE_URL=postgresql://postgres:pw@127.0.0.1:55432/postgres pnpm test:integration

const url = process.env.INTEGRATION_DATABASE_URL;
if (!url) throw new Error("Set INTEGRATION_DATABASE_URL to a local PostGIS database.");
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`Refusing non-local INTEGRATION_DATABASE_URL host ${host}.`);

const dbName = `testalert_it_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const admin = postgres(url, { max: 1, onnotice: () => {} });
const testUrl = Object.assign(new URL(url), { pathname: `/${dbName}` }).toString();
let sql: postgres.Sql;
let lib: typeof import("@/lib/sar/test-alert");
let orgId: string;
let otherOrgId: string;
let memberId: string;
let staffId: string;

const team = () => ({ id: orgId, name: "Summit SAR", isDrill: false, oncallEmail: "dispatch@summit.org", oncallEmailVerifiedAt: new Date() });

beforeAll(async () => {
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  sql = postgres(testUrl, { max: 4, onnotice: () => {} });
  await migrate(drizzle(sql), { migrationsFolder: "lib/db/migrations" });
  const [u, s] = await sql<{ id: string }[]>`INSERT INTO users (email) VALUES ('lead@summit.org'), ('staff@rmdig.ai') RETURNING id`;
  memberId = u!.id;
  staffId = s!.id;
  const orgs = await sql<{ id: string }[]>`
    INSERT INTO sar_orgs (name, contact_name, contact_email, operating_status, proof_doc_url, created_by_user_id, status)
    VALUES ('Summit SAR', 'Lead', 'lead@summit.org', 'county_sar', 'blob://proof', ${memberId}, 'pending'),
           ('Other SAR', 'Lead', 'lead@summit.org', 'county_sar', 'blob://proof', ${memberId}, 'pending')
    RETURNING id`;
  orgId = orgs[0]!.id;
  otherOrgId = orgs[1]!.id;
  process.env.DATABASE_URL = testUrl;
  process.env.AVSERV_NODE_URLS = "mock://localhost";
  lib = await import("@/lib/sar/test-alert");
}, 60_000);

afterAll(async () => {
  await sql?.end();
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

const arrive = (testId: string, org = orgId) => sql`
  INSERT INTO sar_intake_messages (message_id, alert_id, org_id, kind, node, drill, sent_at, payload)
  VALUES (${testId}, ${`test:${testId}`}, ${org}, 'test', 'mock', false, now(), '{}'::jsonb)`;

describe("the test alert store (migration 0040)", () => {
  it("records each node's answer, with the code hashed, never plain", async () => {
    expect(await lib.sendTestAlerts(team(), staffId)).toEqual({ ok: true, nodes: 1, failed: [] });
    const [row] = await sql`SELECT * FROM sar_test_alerts WHERE org_id = ${orgId}`;
    expect(row).toMatchObject({ node: "mock", portal_result: "delivered", email_result: "accepted", error_code: null, requested_by_user_id: staffId });
    expect(row!.code_hash).toBe(lib.hashTestCode(row!.test_id as string, "123456"));
    expect(JSON.stringify(row)).not.toContain('"123456"');
  });

  it("marks a message received only once it's at the intake, and only once", async () => {
    const [row] = await lib.latestTestAlert(orgId);
    expect(row).toMatchObject({ portalArrived: false, portalReceived: false });
    expect(await lib.markTestReceived(orgId, row!.id, memberId)).toMatchObject({ ok: false });

    // Another team's message with the same alert id proves nothing here.
    await arrive(row!.testId!, otherOrgId);
    expect(await lib.markTestReceived(orgId, row!.id, memberId)).toMatchObject({ ok: false });

    await sql`DELETE FROM sar_intake_messages`;
    await arrive(row!.testId!);
    expect((await lib.latestTestAlert(orgId))[0]).toMatchObject({ portalArrived: true });
    expect(await lib.markTestReceived(otherOrgId, row!.id, memberId)).toMatchObject({ ok: false });
    expect(await lib.markTestReceived(orgId, row!.id, memberId)).toEqual({ ok: true });
    expect(await lib.markTestReceived(orgId, row!.id, memberId)).toMatchObject({ ok: false });
    expect((await lib.latestTestAlert(orgId))[0]).toMatchObject({ portalReceived: true });
  });

  it("confirms the email's code, counting wrong guesses", async () => {
    const [row] = await lib.latestTestAlert(orgId);
    expect(await lib.confirmTestCode(orgId, row!.id, "000000", memberId)).toEqual({ ok: false, error: "That code doesn't match. 4 tries left." });
    expect(await lib.confirmTestCode(otherOrgId, row!.id, "123456", memberId)).toEqual({ ok: false, error: "That test isn't one of your team's." });
    expect(await lib.confirmTestCode(orgId, row!.id, "123456", memberId)).toEqual({ ok: true });
    expect(await lib.confirmTestCode(orgId, row!.id, "000000", memberId)).toEqual({ ok: true });
    const fact = await lib.testAlertFact(orgId, new Date());
    expect(fact).toMatchObject({ expired: false, configuredNodes: ["mock"], nodes: [{ node: "mock", portalArrived: true, portalReceived: true, emailConfirmed: true }] });
    expect((await lib.testAlertFact(orgId, new Date(Date.now() + 15 * 86_400_000))).expired).toBe(true);
  });

  it("locks a node's code after five wrong guesses, even racing", async () => {
    await lib.sendTestAlerts(team(), staffId);
    const [row] = await lib.latestTestAlert(orgId);
    expect(row).toMatchObject({ emailConfirmed: false, codeAttemptsLeft: 5 });
    const guesses = await Promise.all(Array.from({ length: 7 }, () => lib.confirmTestCode(orgId, row!.id, "999999", memberId)));
    expect(guesses.every((g) => !g.ok)).toBe(true);
    const [{ code_attempts }] = (await sql`SELECT code_attempts FROM sar_test_alerts WHERE id = ${row!.id}`) as unknown as [{ code_attempts: number }];
    expect(code_attempts).toBe(5);
    expect(await lib.confirmTestCode(orgId, row!.id, "123456", memberId)).toMatchObject({ ok: false, error: expect.stringContaining("Too many wrong codes") });
  });

  it("sends no address the team hasn't confirmed", async () => {
    await lib.sendTestAlerts({ ...team(), oncallEmailVerifiedAt: null }, staffId);
    expect((await lib.latestTestAlert(orgId))[0]).toMatchObject({ email: "not_configured" });
  });

  it("keeps an answer whole: a test id comes with its code, and never with an error", async () => {
    const insert = (cols: { testId: string | null; codeHash: string | null; error: string | null }) => sql`
      INSERT INTO sar_test_alerts (run_id, org_id, node, idempotency_key, test_id, code_hash, error_code)
      VALUES (${randomUUID()}, ${orgId}, 'n', ${randomUUID()}, ${cols.testId}, ${cols.codeHash}, ${cols.error})`;
    await expect(insert({ testId: "x1", codeHash: null, error: null })).rejects.toThrow(/sar_test_alerts_answer/);
    await expect(insert({ testId: "x2", codeHash: "h", error: "http_500" })).rejects.toThrow(/sar_test_alerts_answer/);
    await insert({ testId: null, codeHash: null, error: "unreachable" });
  });
});
