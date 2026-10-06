import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  nodes: [{ name: "avserv-2.rmdig.ai", baseUrl: "https://a2" }, { name: "avserv-3.rmdig.ai", baseUrl: "https://a3" }],
  getSarTeam: vi.fn(),
  readRedFeed: vi.fn(),
  ackSarAlert: vi.fn(),
  readShareLog: vi.fn(),
  lookup: vi.fn(),
}));
vi.mock("@/lib/avserv/sar-teams", () => ({ avservNodes: () => h.nodes, getSarTeam: h.getSarTeam, ackSarAlert: h.ackSarAlert }));
vi.mock("@/lib/avserv/sar-feeds", () => ({ readRedFeed: h.readRedFeed }));
vi.mock("@/lib/avserv/share-log", () => ({ readShareLog: h.readShareLog }));
vi.mock("@/lib/avserv/account-lookup", () => ({ lookupAccountsByEmail: h.lookup }));

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
});

describe("runAvServChecks", () => {
  it("passes every check on every node when each answers as an unknown id should", async () => {
    const r = await runAvServChecks("staff-1");
    expect(r).toHaveLength(10);
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
});
