import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// A confirm-first team's decisions (lib/sar/approvals.ts; plan 33 9.8;
// migration 0044) against real Postgres: each decision is recorded before it
// is sent, with every node's answer after; the row survives the decider's
// account and keeps its team. The AvServ calls are mocked.
//
// INTEGRATION_DATABASE_URL=postgresql://postgres:pw@127.0.0.1:55432/postgres pnpm test:integration

const url = process.env.INTEGRATION_DATABASE_URL;
if (!url) throw new Error("Set INTEGRATION_DATABASE_URL to a local PostGIS database.");
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`Refusing non-local INTEGRATION_DATABASE_URL host ${host}.`);

const h = vi.hoisted(() => ({ decide: vi.fn(), problem: vi.fn() }));
vi.mock("@/lib/avserv/sar-teams", async (orig) => ({
  ...(await orig<typeof import("@/lib/avserv/sar-teams")>()),
  avservNodes: () => [
    { name: "avserv-2", baseUrl: "https://a2" },
    { name: "avserv-3", baseUrl: "https://a3" },
  ],
}));
vi.mock("@/lib/avserv/sar-approvals", async (orig) => ({ ...(await orig<typeof import("@/lib/avserv/sar-approvals")>()), decideApproval: h.decide }));
vi.mock("@/lib/report-error", () => ({ reportProblem: h.problem, reportError: vi.fn() }));

const dbName = `approvals_it_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const admin = postgres(url, { max: 1, onnotice: () => {} });
const testUrl = Object.assign(new URL(url), { pathname: `/${dbName}` }).toString();
let sql: postgres.Sql;
let lib: typeof import("@/lib/sar/approvals");
let orgId: string;
let userId: string;

beforeAll(async () => {
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  sql = postgres(testUrl, { max: 2, onnotice: () => {} });
  await migrate(drizzle(sql), { migrationsFolder: "lib/db/migrations" });
  const [u] = await sql<{ id: string }[]>`INSERT INTO users (email) VALUES ('lead@summit.org') RETURNING id`;
  userId = u!.id;
  const [o] = await sql<{ id: string; acceptance_mode: string }[]>`
    INSERT INTO sar_orgs (name, contact_name, contact_email, operating_status, proof_doc_url, created_by_user_id, status)
    VALUES ('Summit SAR', 'Lead', 'lead@summit.org', 'county_sar', 'blob://p', ${userId}, 'approved') RETURNING id, acceptance_mode`;
  orgId = o!.id;
  // Every team starts open.
  expect(o!.acceptance_mode).toBe("open");
  await sql`UPDATE sar_orgs SET acceptance_mode = 'confirm_first' WHERE id = ${orgId}`;
  process.env.DATABASE_URL = testUrl;
  lib = await import("@/lib/sar/approvals");
}, 60_000);

afterAll(async () => {
  await sql?.end();
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

beforeEach(() => vi.clearAllMocks());

const rows = () => sql`SELECT acceptance_id, state, decided_by_user_id, idempotency_key, node_results FROM sar_approval_decisions WHERE org_id = ${orgId} ORDER BY created_at`;

describe("decideAcceptance (real schema)", () => {
  it("records the decision, sends it to every node under one key, and stores each answer", async () => {
    h.decide.mockImplementation((node: { name: string }) => Promise.resolve({ ok: true, decidedAt: `2026-11-12T01:00:00.00${node.name.at(-1)}Z` }));
    expect(await lib.decideAcceptance(orgId, "acc-1", "approved", userId)).toEqual({ ok: true });
    const [row] = await rows();
    expect(row).toMatchObject({ acceptance_id: "acc-1", state: "approved", decided_by_user_id: userId });
    const keys = h.decide.mock.calls.map((c) => c[4]);
    expect(keys).toEqual([row!.idempotency_key, row!.idempotency_key]);
    expect(h.decide.mock.calls[0]![3]).toEqual({ state: "approved", by: `portal-user:${userId}` });
    expect(row!.node_results).toEqual([
      { node: "avserv-2", ok: true, decidedAt: "2026-11-12T01:00:00.002Z" },
      { node: "avserv-3", ok: true, decidedAt: "2026-11-12T01:00:00.003Z" },
    ]);
  });

  it("counts one node taking it as done (AvServ replicates), and records the other's refusal", async () => {
    h.decide.mockImplementation((node: { name: string }) =>
      Promise.resolve(node.name === "avserv-2" ? { ok: true, decidedAt: "2026-11-12T02:00:00Z" } : { ok: false, status: 404, code: "acceptance_unknown" }),
    );
    expect(await lib.decideAcceptance(orgId, "acc-2", "declined", userId)).toEqual({ ok: true });
    expect((await rows()).at(-1)!.node_results).toEqual([
      { node: "avserv-2", ok: true, decidedAt: "2026-11-12T02:00:00Z" },
      { node: "avserv-3", ok: false, code: "acceptance_unknown" },
    ]);
  });

  it("keeps the decision asked for when no node took it, and gives the most telling reason", async () => {
    h.decide.mockImplementation((node: { name: string }) =>
      Promise.resolve(node.name === "avserv-2" ? { ok: false, status: 404, code: "acceptance_unknown" } : { ok: false, status: 409, code: "acceptance_revoked" }),
    );
    expect(await lib.decideAcceptance(orgId, "acc-3", "approved", userId)).toEqual({ ok: false, code: "acceptance_revoked" });
    expect((await rows()).at(-1)).toMatchObject({ acceptance_id: "acc-3", state: "approved" });
  });

  it("keeps the record when the decider's account goes, and keeps the team from being deleted", async () => {
    await expect(sql`DELETE FROM sar_orgs WHERE id = ${orgId}`).rejects.toThrow(/sar_approval_decisions_org_id_sar_orgs_id_fk/);
    await expect(sql`INSERT INTO sar_approval_decisions (org_id, acceptance_id, state, idempotency_key) VALUES (${orgId}, 'x', 'maybe', ${randomUUID()})`).rejects.toThrow(
      /sar_approval_decisions_state/,
    );
    const [d] = await sql<{ id: string }[]>`INSERT INTO users (email) VALUES ('dispatch@summit.org') RETURNING id`;
    h.decide.mockResolvedValue({ ok: true, decidedAt: "2026-11-12T03:00:00Z" });
    await lib.decideAcceptance(orgId, "acc-4", "approved", d!.id);
    await sql`DELETE FROM users WHERE id = ${d!.id}`;
    const [kept] = await sql`SELECT state, decided_by_user_id FROM sar_approval_decisions WHERE acceptance_id = 'acc-4'`;
    expect(kept).toEqual({ state: "approved", decided_by_user_id: null });
  });
});
