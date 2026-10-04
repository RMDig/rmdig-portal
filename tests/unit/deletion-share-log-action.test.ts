import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  actor: { ok: true, userId: "staff-1" } as { ok: true; userId: string } | { ok: false; error: string },
  admin: true,
  selects: [] as unknown[][],
  read: vi.fn(),
  nodes: [{ name: "avserv-2.rmdig.ai", baseUrl: "https://a2" }, { name: "avserv-3.rmdig.ai", baseUrl: "https://a3" }],
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/auth/portal-actor", () => ({ portalActor: () => Promise.resolve(h.actor) }));
vi.mock("@/lib/auth/roles", () => ({ hasPlatformRole: () => Promise.resolve(h.admin) }));
vi.mock("@/lib/avserv/share-log", () => ({ readShareLog: h.read }));
vi.mock("@/lib/avserv/sar-teams", () => ({ avservNodes: () => h.nodes }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("@/lib/db", () => {
  const select = () => {
    const c: Record<string, unknown> = {};
    c.from = () => c;
    c.where = () => {
      const rows = h.selects.shift() ?? [];
      return Object.assign(Promise.resolve(rows), { limit: () => Promise.resolve(rows) });
    };
    return c;
  };
  return { db: { select } };
});

import { lookupShareLogAction } from "@/app/(portal)/admin/deletion-requests/actions";

const REQ = "11111111-1111-4111-8111-111111111111";
const ACCT = "22222222-2222-4222-8222-222222222222";
const fd = (o: Record<string, string> = {}) => {
  const f = new FormData();
  f.set("requestId", REQ);
  f.set("accountId", ACCT);
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const item = { at: "2026-10-04T10:00:00Z", node: "avserv-2", teamId: "t1", kind: "dispatch", subject: "s", messageKind: "overdue", channel: "portal", fields: ["lastFix"], reader: null, drill: false };

beforeEach(() => {
  vi.clearAllMocks();
  h.actor = { ok: true, userId: "staff-1" };
  h.admin = true;
  h.selects = [];
  h.nodes = [{ name: "avserv-2.rmdig.ai", baseUrl: "https://a2" }, { name: "avserv-3.rmdig.ai", baseUrl: "https://a3" }];
});

describe("lookupShareLogAction", () => {
  it("refuses anyone who isn't an rmdig admin, and a bad account id", async () => {
    h.admin = false;
    expect(await lookupShareLogAction(null, fd())).toMatchObject({ ok: false, error: expect.stringMatching(/platform administrator/) });
    h.admin = true;
    expect(await lookupShareLogAction(null, fd({ accountId: "nope" }))).toMatchObject({ ok: false, error: expect.stringMatching(/UUID/) });
    expect(h.read).not.toHaveBeenCalled();
  });

  it("refuses a request that isn't in the confirmed queue", async () => {
    h.selects = [[]];
    expect(await lookupShareLogAction(null, fd())).toMatchObject({ ok: false, error: expect.stringMatching(/confirmed queue/) });
  });

  it("reads every node and names the teams", async () => {
    h.selects = [[{ id: REQ }], [{ id: "t1", name: "Summit SAR" }]];
    h.read.mockImplementation((n: { name: string }) => Promise.resolve({ ok: true, node: n.name, items: [item] }));
    const r = await lookupShareLogAction(null, fd());
    expect(h.read).toHaveBeenCalledTimes(2);
    expect(h.read).toHaveBeenCalledWith(h.nodes[0], ACCT);
    expect(r).toMatchObject({ ok: true, summary: { status: "complete", teams: [{ teamId: "t1", dispatches: 2 }] }, teamNames: { t1: "Summit SAR" } });
    expect(h.log.info).toHaveBeenCalledWith(expect.objectContaining({ event: "deletion.share_log.lookup", requestId: REQ, staffId: "staff-1" }));
  });

  it("logs a node that didn't answer loudly, and refuses with no nodes configured", async () => {
    h.selects = [[{ id: REQ }], []];
    h.read.mockImplementation((n: { name: string }) =>
      Promise.resolve(n.name.startsWith("avserv-2") ? { ok: true, node: n.name, items: [] } : { ok: false, node: n.name, code: "log_unavailable" }),
    );
    expect(await lookupShareLogAction(null, fd())).toMatchObject({ ok: true, summary: { status: "incomplete" } });
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "deletion.share_log.node_failed", code: "log_unavailable" }));
    h.nodes = [];
    h.selects = [[{ id: REQ }]];
    expect(await lookupShareLogAction(null, fd())).toMatchObject({ ok: false, error: expect.stringMatching(/No AvAI servers/) });
  });
});
