import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  nodes: [{ name: "avserv-2.rmdig.ai", baseUrl: "https://a2" }, { name: "avserv-3.rmdig.ai", baseUrl: "https://a3" }],
  getSarTeam: vi.fn(),
  readRedFeed: vi.fn(),
  ackSarAlert: vi.fn(),
  readShareLog: vi.fn(),
  lookup: vi.fn(),
  health: vi.fn(),
}));
vi.mock("@/lib/avserv/sar-teams", () => ({ avservNodes: () => h.nodes, getSarTeam: h.getSarTeam, ackSarAlert: h.ackSarAlert }));
vi.mock("@/lib/avserv/sar-feeds", () => ({ readRedFeed: h.readRedFeed }));
vi.mock("@/lib/avserv/share-log", () => ({ readShareLog: h.readShareLog }));
vi.mock("@/lib/avserv/account-lookup", () => ({ lookupAccountsByEmail: h.lookup }));
vi.mock("@/lib/avserv/node-health", async (orig) => ({
  ...(await orig<typeof import("@/lib/avserv/node-health")>()),
  readNodeHealth: h.health,
}));

import { PROBE_EMAIL, runAvServChecks } from "@/lib/avserv/checks";
import { AvServError } from "@/lib/avserv/request";

const NONE = "00000000-0000-4000-8000-000000000000";

beforeEach(() => {
  vi.clearAllMocks();
  h.getSarTeam.mockResolvedValue(null);
  h.readRedFeed.mockResolvedValue({ ok: false, node: "n", code: "sar_team_unknown" });
  h.ackSarAlert.mockResolvedValue({ ok: false, status: 404, code: "sar_alert_unknown" });
  h.readShareLog.mockResolvedValue({ ok: true, node: "n", items: [] });
  h.lookup.mockResolvedValue({ ok: true, node: "n", matches: [] });
  h.health.mockImplementation((n: { name: string }) => Promise.resolve({ ok: true, node: n.name, health: healthy(n.name) }));
});

const disk = (o: Partial<{ status: string; freePct: number | null; freeBytes: number | null; totalBytes: number | null; reason: string | null }> = {}) => ({
  name: "disk.docker_vm",
  label: "Docker VM disk",
  status: "ok",
  freeBytes: 33e9,
  totalBytes: 95e9,
  freePct: 34.7,
  reason: null,
  ...o,
});
const healthy = (node: string) => ({ node, asOf: "2026-10-07T18:00:00Z", status: "ok", checks: [disk()] });

describe("runAvServChecks", () => {
  it("passes every check on every node when each answers as an unknown id should", async () => {
    const r = await runAvServChecks("staff-1");
    // Five probes and two node-health rows (overall + one disk) on each of two nodes.
    expect(r).toHaveLength(14);
    expect(r.every((x) => x.ok)).toBe(true);
    expect(h.readRedFeed).toHaveBeenCalledWith(h.nodes[0], NONE, "staff-1");
    expect(h.ackSarAlert).toHaveBeenCalledWith(h.nodes[1], `${NONE}:${NONE}`, { teamId: NONE, by: "portal-user:staff-1" });
    expect(h.lookup).toHaveBeenCalledWith(h.nodes[0], PROBE_EMAIL, "staff-1");
  });

  it("fails a check whose route group is missing on one node, naming the answer", async () => {
    h.lookup.mockImplementation((n: { name: string }) =>
      Promise.resolve(n.name.startsWith("avserv-3") ? { ok: false, node: n.name, code: "path_not_allowed" } : { ok: true, node: n.name, matches: [] }),
    );
    h.getSarTeam.mockRejectedValueOnce(new AvServError("x", 403));
    const r = await runAvServChecks("s");
    expect(r.filter((x) => !x.ok)).toEqual([
      expect.objectContaining({ check: "Team sync", node: "avserv-2.rmdig.ai", answer: "http_403" }),
      expect.objectContaining({ check: "Email lookup", node: "avserv-3.rmdig.ai", answer: "path_not_allowed" }),
    ]);
  });

  it("fails on an unexpected answer and reports a thrown fault (e.g. a signing key) as itself", async () => {
    h.readRedFeed.mockResolvedValue({ ok: false, node: "n", code: "unreachable" });
    h.readShareLog.mockRejectedValue(new Error("AVSERV_SERVICE_JWT_SIGNING_KEY_B64 is not set"));
    const r = await runAvServChecks("s");
    expect(r.find((x) => x.check === "Red alerts feed")).toMatchObject({ ok: false, answer: "unreachable" });
    expect(r.find((x) => x.check === "Deletion lookup")).toMatchObject({ ok: false, answer: expect.stringMatching(/SIGNING_KEY/) });
  });

  it("shows each node's health: overall, then each check in words", async () => {
    const r = await runAvServChecks("s");
    expect(r.filter((x) => x.group === "node_health" && x.node === "avserv-2.rmdig.ai")).toEqual([
      expect.objectContaining({ check: "Node health", ok: true, answer: "ok" }),
      expect.objectContaining({ check: "Docker VM disk", ok: true, answer: "34.7% free (33.0 of 95.0 GB)" }),
    ]);
  });

  it("marks a low disk or an unreadable check as a warning and a failing disk as a failure", async () => {
    h.health.mockResolvedValue({
      ok: true,
      node: "n",
      health: {
        node: "n",
        asOf: "x",
        status: "fail",
        checks: [
          disk({ status: "warn", freePct: 15.2, freeBytes: 14.4e9, reason: "below 20% free" }),
          { ...disk({ status: "unknown", freePct: null, freeBytes: null, totalBytes: null, reason: "statfs failed" }), name: "disk.backup_ring", label: "Backup ring disk" },
          { ...disk({ status: "fail", freePct: 6, freeBytes: 5.7e9, reason: "below 10% free" }), name: "disk.pgdata", label: "Database disk (PGDATA)" },
        ],
      },
    });
    const r = await runAvServChecks("s");
    expect(r.find((x) => x.check === "Docker VM disk")).toMatchObject({ ok: false, warn: true, answer: "15.2% free (14.4 of 95.0 GB) · below 20% free" });
    expect(r.find((x) => x.check === "Backup ring disk")).toMatchObject({ ok: false, warn: true, answer: "statfs failed" });
    expect(r.find((x) => x.check === "Database disk (PGDATA)")).toMatchObject({ ok: false, warn: false });
    expect(r.find((x) => x.check === "Node health")).toMatchObject({ ok: false, warn: false, answer: "fail" });
  });

  it("fails the node-health row when the call itself fails (e.g. the key lacks node_health)", async () => {
    h.health.mockResolvedValue({ ok: false, node: "n", code: "path_not_allowed" });
    const r = await runAvServChecks("s");
    expect(r.filter((x) => x.group === "node_health")).toEqual([
      expect.objectContaining({ check: "Node health", node: "avserv-2.rmdig.ai", ok: false, answer: "path_not_allowed" }),
      expect.objectContaining({ check: "Node health", node: "avserv-3.rmdig.ai", ok: false, answer: "path_not_allowed" }),
    ]);
  });
});
