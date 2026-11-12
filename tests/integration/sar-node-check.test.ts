import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The 5-minute node check (lib/sar/node-check.ts; plan 33 9.11) against real
// Postgres: which teams it sends again, which it reads, and in what order.
// The sync, the read and the AvServ node list are mocked.
//
// INTEGRATION_DATABASE_URL=postgresql://postgres:pw@127.0.0.1:55432/postgres pnpm test:integration

const url = process.env.INTEGRATION_DATABASE_URL;
if (!url) throw new Error("Set INTEGRATION_DATABASE_URL to a local PostGIS database.");
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`Refusing non-local INTEGRATION_DATABASE_URL host ${host}.`);

const h = vi.hoisted(() => ({ sync: vi.fn(), read: vi.fn(), problem: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/avserv/sar-teams", async (orig) => ({
  ...(await orig<typeof import("@/lib/avserv/sar-teams")>()),
  avservNodes: () => [
    { name: "avserv-2", baseUrl: "https://a2" },
    { name: "avserv-3", baseUrl: "https://a3" },
  ],
}));
vi.mock("@/lib/sar/sync", async (orig) => ({ ...(await orig<typeof import("@/lib/sar/sync")>()), syncSarOrg: h.sync }));
vi.mock("@/lib/sar/recovery", () => ({ readTeamRecovery: h.read }));
vi.mock("@/lib/report-error", () => ({ reportProblem: h.problem, reportError: h.error }));

const dbName = `nodecheck_it_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const admin = postgres(url, { max: 1, onnotice: () => {} });
const testUrl = Object.assign(new URL(url), { pathname: `/${dbName}` }).toString();
let sql: postgres.Sql;
let lib: typeof import("@/lib/sar/node-check");
const ids: Record<string, string> = {};
const NOW = new Date("2026-11-11T12:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);
// postgres.js takes a timestamp as text here (no column type to infer from).
const iso = (d: Date | null) => d?.toISOString() ?? null;

async function team(name: string, status: string, sync: Array<{ node: string; outcome: string; code?: string; syncedAt?: Date | null; viewReadAt?: Date | null }>) {
  const [u] = await sql<{ id: string }[]>`INSERT INTO users (email) VALUES (${`${name.toLowerCase()}@sar.org`}) RETURNING id`;
  const [o] = await sql<{ id: string }[]>`
    INSERT INTO sar_orgs (name, contact_name, contact_email, operating_status, proof_doc_url, created_by_user_id, status)
    VALUES (${name}, 'Lead', ${`${name.toLowerCase()}@sar.org`}, 'county_sar', 'blob://p', ${u!.id}, ${status}) RETURNING id`;
  ids[name] = o!.id;
  for (const s of sync) {
    await sql`INSERT INTO sar_org_sync (org_id, node, revision, outcome, error_code, attempted_at, synced_at, view_read_at)
              VALUES (${o!.id}, ${s.node}, 3, ${s.outcome}, ${s.code ?? null}, ${iso(ago(5))}::timestamptz,
                      ${iso(s.syncedAt === undefined ? ago(5) : s.syncedAt)}::timestamptz, ${iso(s.viewReadAt ?? null)}::timestamptz)`;
  }
}

beforeAll(async () => {
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  sql = postgres(testUrl, { max: 2, onnotice: () => {} });
  await migrate(drizzle(sql), { migrationsFolder: "lib/db/migrations" });
  const both = (o: { outcome?: string; viewReadAt?: Date | null } = {}) =>
    ["avserv-2", "avserv-3"].map((node) => ({ node, outcome: o.outcome ?? "ok", viewReadAt: o.viewReadAt ?? null }));
  // Failing on avserv-3 since two hours ago.
  await team("Failing", "approved", [
    { node: "avserv-2", outcome: "ok", viewReadAt: ago(5) },
    { node: "avserv-3", outcome: "error", code: "timeout", syncedAt: ago(120) },
  ]);
  await team("Fresh", "approved", both({ viewReadAt: ago(4) }));
  await team("Stale", "approved", both({ viewReadAt: ago(30) }));
  await team("Leaving", "leaving", both());
  await team("Suspended", "suspended", both({ viewReadAt: ago(60) }));
  await team("Pending", "pending", []);
  process.env.DATABASE_URL = testUrl;
  lib = await import("@/lib/sar/node-check");
}, 60_000);

afterAll(async () => {
  await sql?.end();
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

beforeEach(() => {
  vi.clearAllMocks();
  h.read.mockResolvedValue([{ node: "avserv-2", remedy: null, waitingAlerts: 0, error: null }]);
});

describe("runNodeCheck (real schema)", () => {
  it("sends a failed team again, then reads every other active team, least recently read first", async () => {
    h.sync.mockResolvedValue([{ node: "avserv-2", outcome: "ok" }, { node: "avserv-3", outcome: "ok" }]);
    expect(await lib.runNodeCheck(NOW)).toEqual({ owed: 1, resynced: 1, stillFailing: 0, crashed: 0, read: 3, readFailed: 0 });
    expect(h.sync.mock.calls).toEqual([[ids.Failing]]);
    // Never read: Leaving; then Stale (30 min), Fresh (4 min). Not the
    // suspended or pending team, nor the one the resync just read.
    expect(h.read.mock.calls.map(([id]) => id)).toEqual([ids.Leaving, ids.Stale, ids.Fresh]);
    expect(h.problem).not.toHaveBeenCalled();
  });

  it("reports a node still failing an hour after its last success, and counts a failed read", async () => {
    h.sync.mockResolvedValue([{ node: "avserv-2", outcome: "ok" }, { node: "avserv-3", outcome: "error", code: "timeout" }]);
    h.read.mockResolvedValueOnce([{ node: "avserv-2", remedy: null, waitingAlerts: null, error: "timeout" }]);
    expect(await lib.runNodeCheck(NOW)).toMatchObject({ resynced: 1, stillFailing: 1, readFailed: 1 });
    expect(h.problem).toHaveBeenCalledWith("sar.sync.retry_failing", expect.any(String), expect.objectContaining({ orgId: ids.Failing, node: "avserv-3", code: "timeout" }));
  });

  it("doesn't let one team's crash stop the run, and fails the run loudly", async () => {
    h.sync.mockRejectedValue(new Error("db blip"));
    expect(await lib.runNodeCheck(NOW)).toMatchObject({ owed: 1, resynced: 0, crashed: 1, read: 3 });
    expect(h.error).toHaveBeenCalledWith("sar.node_check.resync_crashed", expect.any(Error), { orgId: ids.Failing });
  });
});
