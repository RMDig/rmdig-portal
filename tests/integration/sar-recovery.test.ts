import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Each node's own view of a team after a sync (lib/sar/recovery.ts; plan 33
// §6.9 F4; migration 0042) against real Postgres: the view is recorded per
// node, a failed read keeps the last good one, and the admins are emailed
// once per new remedy, again when it changes, and afresh after it clears.
// The AvServ GET and the email are mocked.
//
// INTEGRATION_DATABASE_URL=postgresql://postgres:pw@127.0.0.1:55432/postgres pnpm test:integration

const url = process.env.INTEGRATION_DATABASE_URL;
if (!url) throw new Error("Set INTEGRATION_DATABASE_URL to a local PostGIS database.");
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`Refusing non-local INTEGRATION_DATABASE_URL host ${host}.`);

const h = vi.hoisted(() => ({ views: {} as Record<string, unknown>, send: vi.fn(), problem: vi.fn() }));
vi.mock("@/lib/avserv/sar-teams", async (orig) => ({
  ...(await orig<typeof import("@/lib/avserv/sar-teams")>()),
  avservNodes: () => [
    { name: "avserv-2", baseUrl: "https://a2" },
    { name: "avserv-3", baseUrl: "https://a3" },
  ],
  getSarTeam: (node: { name: string }) => {
    const v = h.views[node.name];
    return v instanceof Error ? Promise.reject(v) : Promise.resolve(v ?? null);
  },
}));
vi.mock("@/lib/email/send", () => ({ sendSarTeamRecoveryEmail: h.send }));
vi.mock("@/lib/report-error", () => ({ reportProblem: h.problem, reportError: vi.fn() }));

const dbName = `recovery_it_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const admin = postgres(url, { max: 1, onnotice: () => {} });
const testUrl = Object.assign(new URL(url), { pathname: `/${dbName}` }).toString();
let sql: postgres.Sql;
let lib: typeof import("@/lib/sar/recovery");
let orgId: string;

const view = (o: Record<string, unknown> = {}) => ({ orgId, revision: 3, status: "approved", usable: true, openBindings: 0, channelStatus: [], remedy: null, waitingAlerts: 0, ...o });
const syncRow = async (node: string) => (await sql`SELECT * FROM sar_org_sync WHERE org_id = ${orgId} AND node = ${node}`)[0]!;

beforeAll(async () => {
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  sql = postgres(testUrl, { max: 2, onnotice: () => {} });
  await migrate(drizzle(sql), { migrationsFolder: "lib/db/migrations" });
  const [u] = await sql<{ id: string }[]>`INSERT INTO users (email) VALUES ('lead@summit.org') RETURNING id`;
  const [o] = await sql<{ id: string }[]>`
    INSERT INTO sar_orgs (name, contact_name, contact_email, operating_status, proof_doc_url, created_by_user_id, status)
    VALUES ('Summit SAR', 'Lead', 'lead@summit.org', 'county_sar', 'blob://p', ${u!.id}, 'approved') RETURNING id`;
  orgId = o!.id;
  await sql`INSERT INTO org_memberships (org_id, user_id, role) VALUES (${orgId}, ${u!.id}, 'admin')`;
  for (const node of ["avserv-2", "avserv-3"]) {
    await sql`INSERT INTO sar_org_sync (org_id, node, revision, outcome, usable, attempted_at, synced_at) VALUES (${orgId}, ${node}, 3, 'ok', true, now(), now())`;
  }
  process.env.DATABASE_URL = testUrl;
  lib = await import("@/lib/sar/recovery");
}, 60_000);

afterAll(async () => {
  await sql?.end();
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

beforeEach(() => {
  h.send.mockReset().mockResolvedValue(undefined);
  h.problem.mockReset();
});

describe("readTeamRecovery (real schema)", () => {
  it("records each node's view, and emails nothing while the team is usable", async () => {
    h.views = { "avserv-2": view({ activeCheckouts: 4, overCapacity: false }), "avserv-3": view() };
    expect(await lib.readTeamRecovery(orgId)).toEqual([
      { node: "avserv-2", remedy: null, waitingAlerts: 0, error: null },
      { node: "avserv-3", remedy: null, waitingAlerts: 0, error: null },
    ]);
    expect(await syncRow("avserv-2")).toMatchObject({ remedy: null, waiting_alerts: 0, active_checkouts: 4, over_capacity: false, view_error: null, view_read_at: expect.anything() });
    expect(h.send).not.toHaveBeenCalled();
  });

  it("emails the admins once about a node's new remedy, with what it holds back", async () => {
    h.views = { "avserv-2": view({ usable: false, remedy: "reverify_channel", waitingAlerts: 2 }), "avserv-3": view() };
    await lib.readTeamRecovery(orgId);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send).toHaveBeenCalledWith("lead@summit.org", expect.objectContaining({ teamName: "Summit SAR", nodes: [{ node: "avserv-2", remedy: "reverify_channel", waitingAlerts: 2 }], drill: false }));
    expect(await syncRow("avserv-2")).toMatchObject({ remedy: "reverify_channel", waiting_alerts: 2, remedy_notified: "reverify_channel" });

    await lib.readTeamRecovery(orgId);
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it("emails again when the remedy changes, and afresh once it has cleared and come back", async () => {
    h.views["avserv-2"] = view({ usable: false, remedy: "update_terms", waitingAlerts: 1 });
    await lib.readTeamRecovery(orgId);
    expect(h.send).toHaveBeenCalledTimes(1);
    h.views["avserv-2"] = view();
    await lib.readTeamRecovery(orgId);
    expect(await syncRow("avserv-2")).toMatchObject({ remedy: null, remedy_notified: null });
    h.views["avserv-2"] = view({ usable: false, remedy: "update_terms" });
    await lib.readTeamRecovery(orgId);
    expect(h.send).toHaveBeenCalledTimes(2);
  });

  it("keeps the last good view when a read fails, says so, and reads an unknown remedy as contact_staff", async () => {
    h.views = { "avserv-2": new Error("timeout"), "avserv-3": view({ usable: false, remedy: "teleport" }) };
    const reads = await lib.readTeamRecovery(orgId);
    expect(reads[0]).toMatchObject({ node: "avserv-2", error: "timeout" });
    expect(await syncRow("avserv-2")).toMatchObject({ remedy: "update_terms", view_error: "timeout" });
    expect(await syncRow("avserv-3")).toMatchObject({ remedy: "contact_staff" });
  });

  it("tries again on the next read when no admin could be emailed, and reports it", async () => {
    h.views = { "avserv-2": view(), "avserv-3": view({ usable: false, remedy: "resync" }) };
    h.send.mockRejectedValue(new Error("resend down"));
    await lib.readTeamRecovery(orgId);
    expect(h.problem).toHaveBeenCalledWith("sar.recovery.resync_needed", expect.any(String), expect.anything());
    expect(h.problem).toHaveBeenCalledWith("sar.recovery.email_undelivered", expect.any(String), expect.anything());
    expect(await syncRow("avserv-3")).toMatchObject({ remedy: "resync", remedy_notified: "contact_staff" });
    h.send.mockResolvedValue(undefined);
    await lib.readTeamRecovery(orgId);
    expect(h.send).toHaveBeenLastCalledWith("lead@summit.org", expect.objectContaining({ nodes: [expect.objectContaining({ node: "avserv-3", remedy: "resync" })] }));
    expect(await syncRow("avserv-3")).toMatchObject({ remedy_notified: "resync" });
  });

  it("doesn't email a leaving team about the notice it gave", async () => {
    await sql`UPDATE sar_orgs SET status = 'leaving' WHERE id = ${orgId}`;
    h.views = { "avserv-2": view({ usable: false, remedy: "undo_leaving" }), "avserv-3": view({ usable: false, remedy: "undo_leaving" }) };
    await lib.readTeamRecovery(orgId);
    expect(h.send).not.toHaveBeenCalled();
  });
});
