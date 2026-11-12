import { beforeEach, describe, expect, it, vi } from "vitest";

// The drill team's test alert, sent from Drill teams (plan 37; AvServ plan 66
// R1): rmdig admins only, drill teams only, never for a real team (whose test
// stays the approver's, during review), and not for a past drill team.

const h = vi.hoisted(() => ({
  admin: true,
  org: [] as unknown[],
  latest: [] as Array<{ requestedAt: string }>,
  send: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/auth/mfa-gate", () => ({ userMfaGate: () => Promise.resolve({ gate: "ok", roles: [] }) }));
vi.mock("@/lib/auth/roles", () => ({ hasPlatformRole: (_u: string, role: string) => Promise.resolve(role === "rmdig_admin" && h.admin) }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/sar/test-alert", () => ({ latestTestAlert: () => Promise.resolve(h.latest), sendTestAlerts: h.send }));
vi.mock("@/lib/db", () => {
  const sel: Record<string, unknown> = {};
  sel.from = () => sel;
  sel.where = () => sel;
  sel.limit = () => Promise.resolve(h.org);
  return { db: { select: () => sel } };
});

import { sendDrillTestAlertAction } from "@/app/(portal)/admin/sar-drill/test-alert-actions";
import { auth } from "@/lib/auth";

const ORG = "11111111-1111-4111-8111-111111111111";
const drillTeam = (o: Record<string, unknown> = {}) => ({
  id: ORG,
  name: "AvAI Drill Team",
  status: "approved",
  isDrill: true,
  oncallEmail: null,
  oncallEmailVerifiedAt: null,
  ...o,
});
const send = (orgId = ORG) => {
  const f = new FormData();
  f.set("orgId", orgId);
  return sendDrillTestAlertAction(null, f);
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "admin-1" } } as never);
  h.admin = true;
  h.org = [drillTeam()];
  h.latest = [];
  h.send.mockResolvedValue({ ok: true, nodes: 2, failed: [] });
});

describe("sendDrillTestAlertAction", () => {
  it("sends an active drill team's test from every node, marked drill, and says where the codes go", async () => {
    expect(await send()).toEqual({
      ok: true,
      message: "Sent from 2 nodes. Each code goes to the drill inbox; a drill login enters it on the team's Alerts page.",
    });
    expect(h.send).toHaveBeenCalledWith(expect.objectContaining({ id: ORG, isDrill: true }), "admin-1");
  });

  it("sends for a drill team in any live status, whether or not it was activated", async () => {
    for (const status of ["pending", "suspended", "leaving"]) {
      h.org = [drillTeam({ status })];
      expect((await send()).ok).toBe(true);
    }
  });

  it("refuses anyone but an rmdig admin, and anyone signed out", async () => {
    h.admin = false;
    expect(await send()).toEqual({ ok: false, error: "Only rmdig admins manage drill teams." });
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await send()).ok).toBe(false);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("never sends for a real team: its test is the approver's, during review", async () => {
    h.org = [drillTeam({ isDrill: false, status: "pending" })];
    expect(await send()).toEqual({ ok: false, error: "That isn't a drill team. A real team is tested from the approvals queue, during review." });
    expect(h.log.warn).toHaveBeenCalledWith(expect.objectContaining({ event: "sar.test_alert.drill_refused_real" }));
    expect(h.send).not.toHaveBeenCalled();
  });

  it("refuses a rejected or withdrawn drill team, an unknown id, and a second send within the minute", async () => {
    h.org = [drillTeam({ status: "withdrawn" })];
    expect(await send()).toEqual({ ok: false, error: "This drill team is withdrawn." });
    h.org = [];
    expect(await send()).toEqual({ ok: false, error: "That drill team no longer exists." });
    expect(await send("not-a-uuid")).toEqual({ ok: false, error: "Unknown drill team." });
    h.org = [drillTeam()];
    h.latest = [{ requestedAt: new Date(Date.now() - 10_000).toISOString() }];
    expect(await send()).toEqual({ ok: false, error: "A test was sent less than a minute ago. Wait for its results." });
    expect(h.send).not.toHaveBeenCalled();
  });

  it("fails loudly when no node or only some nodes sent it", async () => {
    h.send.mockResolvedValue({ ok: true, nodes: 2, failed: ["avserv-2", "avserv-3"] });
    expect(await send()).toEqual({ ok: false, error: "No node sent the test (avserv-2, avserv-3). The results are below." });
    h.send.mockResolvedValue({ ok: true, nodes: 2, failed: ["avserv-3"] });
    expect(await send()).toEqual({ ok: true, message: "Sent from 1 of 2 nodes; avserv-3 failed (below)." });
    h.send.mockResolvedValue({ ok: false, error: "No AvServ nodes are configured (AVSERV_NODE_URLS), so no test can be sent." });
    expect((await send()).ok).toBe(false);
  });
});
