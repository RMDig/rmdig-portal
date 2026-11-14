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
  gate: vi.fn(),
  device: vi.fn(),
  sentry: vi.fn(),
  captureException: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/db", () => {
  return {
    db: {
      // Answers by table, so a test that stops after the org read can't put
      // the next test's reads out of step.
      select: () => {
        let table = "";
        const c: Record<string, unknown> = {};
        c.from = (t: Record<symbol, string>) => {
          table = t[Symbol.for("drizzle:Name")] ?? "";
          return c;
        };
        for (const m of ["where", "orderBy"]) c[m] = () => c;
        c.limit = () => Promise.resolve(table === "sar_orgs" ? (h.org ? [h.org] : []) : h.terms);
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
vi.mock("@/lib/avserv/sar-capabilities", () => ({ readFleetRevision: h.gate }));
// The copy itself is built in PostGIS (tests/integration/sar-device-area.test.ts).
vi.mock("@/lib/sar/device-area", () => ({ buildDeviceArea: h.device }));
// Each node's view is read after the PUTs (lib/sar/recovery.ts, tested there).
const recovery = vi.hoisted(() => vi.fn(() => Promise.resolve([])));
vi.mock("@/lib/sar/recovery", () => ({ readTeamRecovery: recovery }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: h.sentry, captureException: h.captureException }));
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
  regionName: null,
  isDrill: false,
  maxActiveCheckouts: null as number | null,
  acceptanceMode: "open" as "open" | "confirm_first",
  nearbyListingAt: null as Date | null,
  syncRevision: 7,
};
const DRILL = { ...ORG, name: "AvAI Drill Team", isDrill: true };
const DEVICE = { geometry: { type: "Polygon", coordinates: [[[-106.1, 38.9], [-104.9, 38.9], [-104.9, 40.1], [-106.1, 38.9]]] }, toleranceMeters: 50, bufferMeters: 51 };
const TERMS = { version: 1, sha256: "a".repeat(64), publishedAt: new Date(), body: "t", requiresReacceptance: true, capabilities: [{ name: "checkout_alerts", channels: ["portal"] }] };

beforeEach(() => {
  vi.clearAllMocks();
  h.org = ORG;
  h.terms = [TERMS];
  h.recorded = [];
  h.gate.mockResolvedValue({ revision: 3, nodes: [] });
  h.device.mockResolvedValue({ ok: true, points: 5, deviceArea: DEVICE });
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

  it("then reads each node's own view of the team, after recording the PUTs (plan 33 §6.9 F4)", async () => {
    recovery.mockClear();
    await syncSarOrg(ORG.id);
    expect(recovery).toHaveBeenCalledWith(ORG.id);
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

  it("sends a real team whatever the fleet reports, with no drill field", async () => {
    h.gate.mockResolvedValue({ revision: 0, nodes: [] });
    await syncSarOrg(ORG.id);
    expect(h.put).toHaveBeenCalledTimes(2);
    expect("drill" in h.put.mock.calls[0]![1]).toBe(false);
  });

  it("sends a capped team's cap at revision 2, and holds it below (plan 33 §6.2)", async () => {
    h.org = { ...ORG, maxActiveCheckouts: 25 };
    await syncSarOrg(ORG.id);
    expect(h.put.mock.calls[0]![1]).toMatchObject({ maxActiveCheckouts: 25 });
    h.put.mockClear();
    h.gate.mockResolvedValue({ revision: 1, nodes: [] });
    const out = await syncSarOrg(ORG.id);
    expect(h.put).not.toHaveBeenCalled();
    expect(out[0]).toMatchObject({ outcome: "skipped", reason: "settings_support_pending" });
  });

  it("throws for an unknown org", async () => {
    h.org = null;
    await expect(syncSarOrg(ORG.id)).rejects.toThrow(/unknown org/);
  });
});

describe("syncSarOrg for a drill team (plan 37 §4.5)", () => {
  beforeEach(() => {
    h.org = DRILL;
  });

  it("sends drill: true once every node supports revision 3", async () => {
    await syncSarOrg(ORG.id);
    expect(h.put).toHaveBeenCalledTimes(2);
    expect(h.put.mock.calls[0]![1]).toMatchObject({ drill: true, displayName: "AvAI Drill Team" });
  });

  it("holds it, records why per node and logs which node is behind, without bumping or sending", async () => {
    const nodes = [{ node: "avserv-2", ok: true, syncRevision: 3 }, { node: "avserv-3", ok: true, syncRevision: 2 }];
    h.gate.mockResolvedValue({ revision: 2, nodes });
    const out = await syncSarOrg(ORG.id);
    expect(h.put).not.toHaveBeenCalled();
    expect(out).toEqual([
      { node: "avserv-2", outcome: "skipped", reason: "drill_support_pending" },
      { node: "avserv-3", outcome: "skipped", reason: "drill_support_pending" },
    ]);
    expect(h.recorded[0]).toMatchObject({ revision: 7, outcome: "skipped", unusableReason: "drill_support_pending" });
    expect(h.log.warn).toHaveBeenCalledWith({ event: "sar.sync.drill_held", orgId: ORG.id, needs: 3, nodes });
  });

  it("reports AvServ's permanent drill refusals to Sentry", async () => {
    h.put.mockResolvedValueOnce({ ok: false, status: 422, code: "drill_team_invalid", retryable: false });
    h.put.mockResolvedValueOnce({ ok: false, status: 409, code: "sar_team_drill_immutable", retryable: false });
    const out = await syncSarOrg(ORG.id);
    expect(out.map((o) => o.outcome === "error" && o.code)).toEqual(["drill_team_invalid", "sar_team_drill_immutable"]);
    expect(h.sentry).toHaveBeenCalledTimes(2);
    expect(h.sentry).toHaveBeenCalledWith(
      "AvServ refused a SAR team sync: sar_team_drill_immutable",
      expect.objectContaining({ level: "error", tags: expect.objectContaining({ event: "sar.sync.drill_refused", node: "avserv-3" }) }),
    );
  });

  it("keeps a busy node's 503 an ordinary, logged node failure", async () => {
    h.put.mockResolvedValueOnce({ ok: false, status: 503, code: "sar_capture_unavailable", retryable: true });
    await syncSarOrg(ORG.id);
    expect(h.sentry).not.toHaveBeenCalled();
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "sar.sync.node_failed", code: "sar_capture_unavailable" }));
  });
});

describe("syncSarOrg at revision 4 (AvApp plan 68)", () => {
  beforeEach(() => {
    h.gate.mockResolvedValue({ revision: 4, nodes: [] });
  });

  it("builds the device copy from the area as sent, and sends it", async () => {
    await syncSarOrg(ORG.id);
    expect(h.device).toHaveBeenCalledWith({ type: "Polygon", coordinates: [[[-106, 39], [-105, 39], [-105, 40], [-106, 39]]] });
    expect(h.put.mock.calls[0]![1]).toMatchObject({ deviceServiceArea: DEVICE });
  });

  it("sends nearbyListing for a team that turned it on", async () => {
    h.org = { ...ORG, nearbyListingAt: new Date("2026-11-13T15:00:00Z") };
    await syncSarOrg(ORG.id);
    expect(h.put.mock.calls[0]![1]).toMatchObject({ nearbyListing: { consent: true, consentAt: "2026-11-13T15:00:00.000Z" } });
  });

  it("never builds a copy below revision 4", async () => {
    h.gate.mockResolvedValue({ revision: 3, nodes: [] });
    await syncSarOrg(ORG.id);
    expect(h.device).not.toHaveBeenCalled();
    expect("deviceServiceArea" in h.put.mock.calls[0]![1]).toBe(false);
  });

  it("sends the team without a copy that failed its check, and reports it to Sentry", async () => {
    h.device.mockResolvedValue({ ok: false, reason: "not_covering", points: 12 });
    await syncSarOrg(ORG.id);
    expect(h.put).toHaveBeenCalledTimes(2);
    expect("deviceServiceArea" in h.put.mock.calls[0]![1]).toBe(false);
    expect(h.sentry).toHaveBeenCalledWith(expect.stringMatching(/phone copy/), expect.objectContaining({ tags: { event: "sar.sync.device_area_failed" } }));
  });

  it("sends the team without a copy when building it throws, and reports it", async () => {
    h.device.mockRejectedValue(new Error("db down"));
    await syncSarOrg(ORG.id);
    expect(h.put).toHaveBeenCalledTimes(2);
    expect(h.captureException).toHaveBeenCalled();
  });

  it("logs no coordinates, only whether a copy was sent (plan 68 d)", async () => {
    await syncSarOrg(ORG.id);
    const logged = JSON.stringify([...h.log.info.mock.calls, ...h.log.warn.mock.calls, ...h.log.error.mock.calls]);
    expect(logged).not.toMatch(/-10[56]\./);
    expect(logged).not.toMatch(/coordinates/);
    expect(h.log.info).toHaveBeenCalledWith(expect.objectContaining({ event: "sar.sync.sent", fleetRevision: 4, deviceArea: true }));
  });
});
