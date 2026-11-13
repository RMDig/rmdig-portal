import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// An erasure's delete of the portal's copies (lib/deletion/intake-copies.ts;
// plan 33 §6.9, F6) against real Postgres: exactly the erased account's
// alerts go, with their acks and team-email records, and its approval
// decisions at each team (9.8), and nobody else's.
// The share log is mocked; the SQL is real.
//
// INTEGRATION_DATABASE_URL=postgresql://postgres:pw@127.0.0.1:55432/postgres pnpm test:integration

const url = process.env.INTEGRATION_DATABASE_URL;
if (!url) throw new Error("Set INTEGRATION_DATABASE_URL to a local PostGIS database.");
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`Refusing non-local INTEGRATION_DATABASE_URL host ${host}.`);

const h = vi.hoisted(() => ({ items: [] as unknown[] }));
vi.mock("@/lib/avserv/sar-teams", () => ({ avservNodes: () => [{ name: "avserv-2", baseUrl: "https://a2" }] }));
vi.mock("@/lib/avserv/share-log", () => ({ readShareLog: () => Promise.resolve({ ok: true, node: "avserv-2", items: h.items }) }));

const dbName = `copies_it_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const admin = postgres(url, { max: 1, onnotice: () => {} });
const testUrl = Object.assign(new URL(url), { pathname: `/${dbName}` }).toString();
let sql: postgres.Sql;
let lib: typeof import("@/lib/deletion/intake-copies");
let teamA: string;
let teamB: string;

const msg = (id: string, org: string, alertId: string, kind = "overdue") => sql`
  INSERT INTO sar_intake_messages (message_id, alert_id, org_id, kind, node, drill, sent_at, payload)
  VALUES (${id}, ${alertId}, ${org}, ${kind}, 'avserv-2', false, now(), '{}'::jsonb)`;

beforeAll(async () => {
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  sql = postgres(testUrl, { max: 2, onnotice: () => {} });
  await migrate(drizzle(sql), { migrationsFolder: "lib/db/migrations" });
  const [u] = await sql<{ id: string }[]>`INSERT INTO users (email) VALUES ('lead@sar.org') RETURNING id`;
  const orgs = await sql<{ id: string }[]>`
    INSERT INTO sar_orgs (name, contact_name, contact_email, operating_status, proof_doc_url, created_by_user_id, status)
    VALUES ('A', 'L', 'lead@sar.org', 'county_sar', 'blob://p', ${u!.id}, 'approved'),
           ('B', 'L', 'lead@sar.org', 'county_sar', 'blob://p', ${u!.id}, 'approved')
    RETURNING id`;
  teamA = orgs[0]!.id;
  teamB = orgs[1]!.id;
  // The erased account's alert sub-1, sent to team A (alert, all-clear, and
  // its team email and ack) and to team B; another account's alert sub-2 at A.
  await msg("m1", teamA, `sub-1:${teamA}`);
  await msg("m2", teamA, `sub-1:${teamA}`, "all_clear");
  await msg("m3", teamB, `sub-1:${teamB}`);
  await msg("m4", teamA, `sub-2:${teamA}`);
  await sql`INSERT INTO sar_alert_notifications (org_id, alert_id, kind, message_id) VALUES (${teamA}, ${`sub-1:${teamA}`}, 'overdue', 'm1')`;
  await sql`INSERT INTO sar_alert_acks (org_id, alert_id, acked_at) VALUES (${teamA}, ${`sub-1:${teamA}`}, now()), (${teamA}, ${`sub-2:${teamA}`}, now())`;
  // Decisions on the erased account's acceptance acc-1 at A (approved, then
  // withdrawn) and at B; another account's acc-2 at A; acc-1 at B is only
  // matched as B's, never as A's.
  await sql`
    INSERT INTO sar_approval_decisions (org_id, acceptance_id, state, idempotency_key) VALUES
      (${teamA}, 'acc-1', 'approved', ${randomUUID()}), (${teamA}, 'acc-1', 'declined', ${randomUUID()}),
      (${teamB}, 'acc-1', 'approved', ${randomUUID()}), (${teamA}, 'acc-2', 'approved', ${randomUUID()}),
      (${teamB}, 'acc-3', 'approved', ${randomUUID()})`;
  process.env.DATABASE_URL = testUrl;
  lib = await import("@/lib/deletion/intake-copies");
}, 60_000);

afterAll(async () => {
  await sql?.end();
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

const dispatch = (teamId: string, subject: string, kind = "dispatch") => ({
  at: "2026-11-01T10:00:00Z", node: "avserv-2", teamId, kind, subject, messageKind: "overdue", channel: "portal", fields: [], reader: null, drill: false,
});

describe("deleteIntakeCopies (real schema)", () => {
  it("deletes the account's alerts at every team, with their acks and email records, and nothing else", async () => {
    h.items = [dispatch(teamA, "sub-1"), dispatch(teamB, "sub-1"), dispatch(teamA, "acc-1", "approval_request"), dispatch(teamB, "acc-1", "approval_request")];
    expect(await lib.deleteIntakeCopies(randomUUID(), "req-1")).toEqual({
      status: "complete",
      alerts: 2,
      messagesDeleted: 3,
      acksDeleted: 1,
      decisionsDeleted: 3,
      unavailable: [],
    });
    expect((await sql`SELECT message_id FROM sar_intake_messages`).map((r) => r.message_id)).toEqual(["m4"]);
    expect((await sql`SELECT alert_id FROM sar_alert_acks`).map((r) => r.alert_id)).toEqual([`sub-2:${teamA}`]);
    expect(await sql`SELECT 1 FROM sar_alert_notifications`).toHaveLength(0);
    expect((await sql`SELECT acceptance_id FROM sar_approval_decisions ORDER BY acceptance_id`).map((r) => r.acceptance_id)).toEqual(["acc-2", "acc-3"]);
  });

  it("is a no-op the second time, and with nothing in the log", async () => {
    expect(await lib.deleteIntakeCopies(randomUUID(), "req-1")).toMatchObject({ status: "complete", messagesDeleted: 0, acksDeleted: 0, decisionsDeleted: 0 });
    h.items = [];
    expect(await lib.deleteIntakeCopies(randomUUID(), "req-2")).toMatchObject({ status: "complete", alerts: 0, messagesDeleted: 0 });
  });
});
