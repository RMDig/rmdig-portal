import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The new-request email to a confirm-first team's admins (lib/sar/approval-notify.ts;
// plan 33 9.8; migration 0045) against real Postgres: only confirm-first teams
// AvServ holds are read, every admin and nobody else is emailed, and the
// newest time is recorded only once someone was told. AvServ and email are
// mocked.
//
// INTEGRATION_DATABASE_URL=postgresql://postgres:pw@127.0.0.1:55432/postgres pnpm test:integration

const url = process.env.INTEGRATION_DATABASE_URL;
if (!url) throw new Error("Set INTEGRATION_DATABASE_URL to a local PostGIS database.");
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`Refusing non-local INTEGRATION_DATABASE_URL host ${host}.`);

const h = vi.hoisted(() => ({ summary: vi.fn(), send: vi.fn(), problem: vi.fn() }));
vi.mock("@/lib/avserv/sar-teams", async (orig) => ({
  ...(await orig<typeof import("@/lib/avserv/sar-teams")>()),
  avservNodes: () => [
    { name: "avserv-2", baseUrl: "https://a2" },
    { name: "avserv-3", baseUrl: "https://a3" },
  ],
}));
vi.mock("@/lib/avserv/sar-approvals", async (orig) => ({ ...(await orig<typeof import("@/lib/avserv/sar-approvals")>()), getApprovalSummary: h.summary }));
vi.mock("@/lib/email/send", () => ({ sendSarApprovalWaitingEmail: h.send }));
vi.mock("@/lib/report-error", () => ({ reportProblem: h.problem, reportError: vi.fn() }));

const dbName = `apnotify_it_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const admin = postgres(url, { max: 1, onnotice: () => {} });
const testUrl = Object.assign(new URL(url), { pathname: `/${dbName}` }).toString();
let sql: postgres.Sql;
let lib: typeof import("@/lib/sar/approval-notify");
let team: string;

// As UTC text to the millisecond, so the check doesn't depend on how the client parses timestamps.
const through = async () =>
  (await sql<{ t: string | null }[]>`
    SELECT to_char(approval_notified_through AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS t FROM sar_orgs WHERE id = ${team}`)[0]!.t;
const waiting = (newest: string | null) => h.summary.mockResolvedValue({ ok: true, pending: newest ? 1 : 0, newestPendingAcceptedAt: newest });

beforeAll(async () => {
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  sql = postgres(testUrl, { max: 2, onnotice: () => {} });
  await migrate(drizzle(sql), { migrationsFolder: "lib/db/migrations" });
  const people = await sql<{ id: string }[]>`
    INSERT INTO users (email) VALUES ('lead@summit.org'), ('second@summit.org'), ('member@summit.org') RETURNING id`;
  const [lead, second, member] = people.map((p) => p.id);
  const org = (name: string, status: string, mode: string) => sql<{ id: string }[]>`
    INSERT INTO sar_orgs (name, contact_name, contact_email, operating_status, proof_doc_url, created_by_user_id, status, acceptance_mode)
    VALUES (${name}, 'Lead', 'lead@summit.org', 'county_sar', 'blob://p', ${lead!}, ${status}, ${mode}) RETURNING id`;
  team = (await org("Summit SAR", "approved", "confirm_first"))[0]!.id;
  // Neither of these is read: an open team, and one AvServ doesn't hold yet.
  await org("Open SAR", "approved", "open");
  await org("New SAR", "pending", "confirm_first");
  await sql`
    INSERT INTO org_memberships (org_id, user_id, role) VALUES
      (${team}, ${lead!}, 'admin'), (${team}, ${second!}, 'admin'), (${team}, ${member!}, 'responder')`;
  process.env.DATABASE_URL = testUrl;
  lib = await import("@/lib/sar/approval-notify");
}, 60_000);

afterAll(async () => {
  await sql?.end();
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

beforeEach(() => {
  vi.clearAllMocks();
  h.send.mockResolvedValue(undefined);
});

describe("runApprovalNotify (real schema)", () => {
  it("emails every admin of a confirm-first team, nobody else, and records the newest time to the millisecond", async () => {
    waiting("2026-11-12T10:00:00.123456789Z");
    expect(await lib.runApprovalNotify()).toEqual({ teams: 1, notified: 1, sent: 2, failed: 0, unread: 0 });
    expect(h.summary.mock.calls.map((c) => c[1])).toEqual([team, team]);
    expect(h.send.mock.calls.map((c) => c[0]).sort()).toEqual(["lead@summit.org", "second@summit.org"]);
    expect(h.send.mock.calls[0]![1]).toEqual({ teamName: "Summit SAR", approvalsUrl: expect.stringContaining(`/sar/${team}/approvals`), drill: false });
    expect(await through()).toBe("2026-11-12T10:00:00.123Z");
  });

  it("doesn't email again for the same request, and does for a newer one", async () => {
    waiting("2026-11-12T10:00:00.123456789Z");
    expect((await lib.runApprovalNotify()).sent).toBe(0);
    waiting("2026-11-12T10:05:00Z");
    expect((await lib.runApprovalNotify()).sent).toBe(2);
    expect(await through()).toBe("2026-11-12T10:05:00.000Z");
  });

  it("records nothing when no admin could be told, so the next run tries again", async () => {
    waiting("2026-11-12T11:00:00Z");
    h.send.mockRejectedValue(new Error("resend down"));
    expect(await lib.runApprovalNotify()).toMatchObject({ notified: 0, sent: 0, failed: 2 });
    expect(h.problem).toHaveBeenCalledWith("sar.approval_notify.email_undelivered", expect.any(String), { orgId: team });
    expect(await through()).toBe("2026-11-12T10:05:00.000Z");
    h.send.mockResolvedValue(undefined);
    expect((await lib.runApprovalNotify()).sent).toBe(2);
  });

  it("reports a team no node could read, and emails nobody", async () => {
    h.summary.mockResolvedValue({ ok: false, status: undefined, code: "unreachable" });
    expect(await lib.runApprovalNotify()).toMatchObject({ unread: 1, sent: 0 });
    expect(h.problem).toHaveBeenCalledWith("sar.approval_notify.unread", expect.any(String), { orgId: team });
  });
});
