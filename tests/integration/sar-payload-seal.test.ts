import { randomBytes, randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { IntakePayload } from "@/lib/sar/intake";
import { openPayload, parseSarPayloadKeys, sealPayload } from "@/lib/sar/payload-seal";

// Sealed SAR alert details (plan 36 H4) in real Postgres: the jsonb holds
// ciphertext, and retention (lib/sar/retention.ts) still removes the position
// and route 24 hours after an alert ends, by path, while the sealed note stays
// readable until the alert is deleted.
//
// INTEGRATION_DATABASE_URL=postgresql://postgres:pw@127.0.0.1:55432/postgres pnpm test:integration

const url = process.env.INTEGRATION_DATABASE_URL;
if (!url) throw new Error("Set INTEGRATION_DATABASE_URL to a local PostGIS database.");
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") {
  throw new Error(`Refusing non-local INTEGRATION_DATABASE_URL host ${host}: integration tests never touch Neon.`);
}

const dbName = `seal_it_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const admin = postgres(url, { max: 1, onnotice: () => {} });
const testUrl = Object.assign(new URL(url), { pathname: `/${dbName}` }).toString();
let sql: postgres.Sql;

const ORG = randomUUID();
const keys = parseSarPayloadKeys(`s1:${randomBytes(32).toString("hex")}`);
const NOW = new Date("2026-10-20T12:00:00Z");
const envelope = { schemaVersion: 1 as const, teamId: ORG, capability: null, node: "avserv-2", drill: false, sentAt: "2026-10-18T10:00:00Z" };
const fix = { lat: 39.61234, lon: -106.05678, accuracyMeters: 12, at: "2026-10-18T09:55:00Z" };
const overdue: IntakePayload = {
  ...envelope,
  messageId: "m-overdue",
  alertId: "a-overdue",
  kind: "overdue",
  alert: { checkoutId: "c1", userDisplayName: "Pat", lastFix: fix, plannedRoute: { type: "MultiLineString", coordinates: [[[-106.06, 39.47], [-106.02, 39.5]]] }, expectedReturnAt: null, alertedAt: null },
};
const sendHelp: IntakePayload = {
  ...envelope,
  messageId: "m-help",
  alertId: "a-help",
  kind: "send_help",
  alert: { helpRequestId: "h1", userDisplayName: "Pat", lastFix: fix, note: "Twisted ankle below the ridge", checkoutId: null, openedAt: null },
};

async function store(p: IntakePayload, sentAt: string) {
  await sql`INSERT INTO sar_intake_messages (message_id, alert_id, org_id, kind, node, drill, sent_at, payload)
            VALUES (${p.messageId}, ${p.alertId}, ${ORG}, ${p.kind}, 'avserv-2', false, ${sentAt}, ${JSON.stringify(sealPayload(keys, p))}::jsonb)`;
}

beforeAll(async () => {
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  sql = postgres(testUrl, { max: 2, onnotice: () => {} });
  await migrate(drizzle(sql), { migrationsFolder: "lib/db/migrations" });
  const [user] = await sql<{ id: string }[]>`INSERT INTO users (email) VALUES ('lead@sar.org') RETURNING id`;
  await sql`INSERT INTO sar_orgs (id, name, contact_name, contact_email, operating_status, proof_doc_url, created_by_user_id, status)
            VALUES (${ORG}, 'Summit SAR', 'Lead', 'lead@sar.org', 'county_sar', 'blob://proof', ${user!.id}, 'approved')`;
  await store(overdue, "2026-10-18T10:00:00Z");
  await store(sendHelp, "2026-10-18T10:00:00Z");
  for (const [id, refersTo] of [["m-clear-1", "a-overdue"], ["m-clear-2", "a-help"]] as const) {
    const clear = { ...envelope, messageId: id, alertId: refersTo, kind: "all_clear", alert: { refersTo, at: null } };
    await sql`INSERT INTO sar_intake_messages (message_id, alert_id, org_id, kind, node, drill, sent_at, payload)
              VALUES (${id}, ${refersTo}, ${ORG}, 'all_clear', 'avserv-2', false, '2026-10-18T11:00:00Z', ${JSON.stringify(clear)}::jsonb)`;
  }
  process.env.DATABASE_URL = testUrl;
}, 60_000);

afterAll(async () => {
  await sql?.end();
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

const rows = () => sql<{ message_id: string; payload: unknown }[]>`SELECT message_id, payload FROM sar_intake_messages WHERE kind <> 'all_clear' ORDER BY message_id`;

describe("sealed SAR payloads (Postgres)", () => {
  it("stores ciphertext, not the position or note, and reads back exactly", async () => {
    const stored = await rows();
    expect(JSON.stringify(stored)).not.toMatch(/39\.61|ankle|MultiLineString/);
    expect(stored.map((r) => openPayload(() => keys, r.payload))).toEqual([sendHelp, overdue]);
  });

  it("retention still removes the position and route 24 h after the alert ends; the note stays sealed and readable", async () => {
    const { runSarRetention } = await import("@/lib/sar/retention");
    const summary = await runSarRetention(NOW);
    expect(summary.positionsRemoved).toBe(2);
    const [help, over] = (await rows()).map((r) => openPayload(() => keys, r.payload));
    expect(over).toMatchObject({ alert: { lastFix: null, plannedRoute: null, checkoutId: "c1" } });
    expect(help).toMatchObject({ alert: { lastFix: null, note: "Twisted ankle below the ridge" } });
    const raw = (await rows())[0]!.payload as { alert: { note: string } };
    expect(raw.alert.note).toMatch(/^v1:s1:/);
  });
});
