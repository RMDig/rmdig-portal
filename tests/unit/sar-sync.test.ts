import { beforeEach, describe, expect, it, vi } from "vitest";

// syncSarOrg: bumps the revision, PUTs to every node, records each node's
// answer, and never lets one node's failure hide the other's.

const h = vi.hoisted(() => ({
  org: null as unknown,
  geo: [{ geojson: JSON.stringify({ type: "Polygon", coordinates: [[[-106, 39], [-105, 39], [-105, 40], [-106, 39]]] }) }] as unknown[],
  terms: [] as unknown[],
  nextRevision: 8,
  recorded: [] as unknown[],
  put: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/db", () => {
  let selectN = 0;
  return {
    db: {
      select: () => {
        const idx = selectN++ % 2;
        const c: Record<string, unknown> = {};
        for (const m of ["from", "where", "orderBy"]) c[m] = () => c;
        c.limit = () => Promise.resolve(idx === 0 ? (h.org ? [h.org] : []) : h.terms);
        return c;
      },
      execute: () => Promise.resolve(h.geo),
      update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([{ revision: h.nextRevision }]) }) }) }),
      insert: () => ({ values: (v: unknown) => ({ onConflictDoUpdate: () => { h.recorded.push(v); return Promise.resolve(); } }) }),
    },
  };
});
vi.mock("@/lib/avserv/sar-teams", () => ({
  avservNodes: () => [{ name: "avserv-2", baseUrl: "https://a" }, { name: "avserv-3", baseUrl: "https://b" }],
  putSarTeam: h.put,
}));
vi.mock("@/lib/logger", () => ({ logger: h.log }));

import { syncSarOrg } from "@/lib/sar/sync";

const ORG = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Summit SAR",
  orgType: "sar_team",
  status: "approved",
  approvedAt: new Date("2026-10-01T00:00:00Z"),
  approvedByUserId: "staff-1",
  verifiedAt: null,
  reverifyBy: null,
  leavingNoticeAt: null,
  syncRevision: 7,
};
const TERMS = { version: 1, sha256: "a".repeat(64), publishedAt: new Date(), body: "t", requiresReacceptance: true, capabilities: [{ name: "checkout_alerts", channels: ["portal"] }] };

beforeEach(() => {
  vi.clearAllMocks();
  h.org = ORG;
  h.terms = [TERMS];
  h.recorded = [];
  h.put.mockResolvedValue({ ok: true, result: { orgId: ORG.id, revision: 8, applied: true, usable: true, unusableReason: null } });
});

describe("syncSarOrg", () => {
  it("sends the bumped revision to every node and records both", async () => {
    const out = await syncSarOrg(ORG.id);
    expect(h.put).toHaveBeenCalledTimes(2);
    expect(h.put.mock.calls[0]![1]).toMatchObject({ revision: 8, status: "approved" });
    expect(out.map((o) => o.outcome)).toEqual(["ok", "ok"]);
    expect(h.recorded).toEqual([
      expect.objectContaining({ node: "avserv-2", revision: 8, outcome: "ok", syncedAt: expect.any(Date) }),
      expect.objectContaining({ node: "avserv-3", revision: 8, outcome: "ok" }),
    ]);
  });

  it("records a failed node with its code and logs it loudly, keeping the other node's success", async () => {
    h.put.mockResolvedValueOnce({ ok: true, result: { orgId: ORG.id, revision: 8, applied: true, usable: true, unusableReason: null } });
    h.put.mockResolvedValueOnce({ ok: false, status: 503, code: "sar_capture_unavailable", retryable: true });
    const out = await syncSarOrg(ORG.id);
    expect(out).toEqual([
      expect.objectContaining({ node: "avserv-2", outcome: "ok" }),
      { node: "avserv-3", outcome: "error", code: "sar_capture_unavailable" },
    ]);
    expect(h.recorded[1]).toMatchObject({ outcome: "error", errorCode: "sar_capture_unavailable", syncedAt: null });
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "sar.sync.node_failed", node: "avserv-3" }));
  });

  it("skips (and records why) when there are no published terms, without bumping or sending", async () => {
    h.terms = [];
    const out = await syncSarOrg(ORG.id);
    expect(h.put).not.toHaveBeenCalled();
    expect(out.every((o) => o.outcome === "skipped" && o.reason === "no_published_terms")).toBe(true);
    expect(h.recorded[0]).toMatchObject({ revision: 7, outcome: "skipped", unusableReason: "no_published_terms" });
  });

  it("throws for an unknown org", async () => {
    h.org = null;
    await expect(syncSarOrg(ORG.id)).rejects.toThrow(/unknown org/);
  });
});
