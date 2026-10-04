import { beforeEach, describe, expect, it, vi } from "vitest";

// Marking an alert received (AvServ contacts_delete_and_sar_ack.md §2): each
// delivering node gets its own ledger key; recorded once any node accepts.

const h = vi.hoisted(() => ({
  role: "dispatcher" as string | null,
  gate: "ok" as string,
  deliveries: [] as Array<{ messageId: string; node: string; kind: string }>,
  acks: [] as unknown[],
  ack: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/auth/org-roles", () => ({ getOrgRole: () => Promise.resolve(h.role) }));
vi.mock("@/lib/auth/mfa-gate", () => ({ userMfaGate: () => Promise.resolve({ gate: h.gate, roles: [] }) }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/avserv/sar-teams", () => {
  const nodes = [
    { name: "avserv-2.rmdig.ai", baseUrl: "https://avserv-2.rmdig.ai" },
    { name: "avserv-3.rmdig.ai", baseUrl: "https://avserv-3.rmdig.ai" },
  ];
  return {
    avservNodes: () => nodes,
    ackSarAlert: h.ack,
  };
});
vi.mock("@/lib/db", () => {
  const sel: Record<string, unknown> = {};
  sel.from = () => sel;
  sel.where = () => sel;
  sel.limit = () => Promise.resolve(h.deliveries.slice(0, 1));
  return {
    db: {
      select: () => sel,
      insert: () => ({ values: (v: unknown) => ({ onConflictDoNothing: () => (h.acks.push(v), Promise.resolve()) }) }),
    },
  };
});

import { ackAlertAction } from "@/app/(portal)/sar/[orgId]/alerts/actions";
import { auth } from "@/lib/auth";

const authMock = vi.mocked(auth);
const form = (alertId = "sub:team") => {
  const fd = new FormData();
  fd.set("alertId", alertId);
  return fd;
};

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "u1" } } as never);
  h.role = "dispatcher";
  h.gate = "ok";
  h.acks = [];
  h.deliveries = [
    { messageId: "m2", node: "avserv-2", kind: "overdue" },
    { messageId: "m3", node: "avserv-3", kind: "overdue" },
    { messageId: "m4", node: "avserv-2", kind: "all_clear" },
  ];
  h.ack.mockResolvedValue({ ok: true, first: true, at: "2026-10-05T19:00:05Z" });
});

describe("ackAlertAction", () => {
  it("rejects signed-out callers and members who aren't admins or dispatchers", async () => {
    authMock.mockResolvedValue(null as never);
    expect((await ackAlertAction("org", null, form())).ok).toBe(false);
    authMock.mockResolvedValue({ user: { id: "u1" } } as never);
    h.role = "responder";
    const res = await ackAlertAction("org", null, form());
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/admins and dispatchers/) });
    expect(h.ack).not.toHaveBeenCalled();
  });

  it("refuses an admin who hasn't set up required MFA (actions skip the layout's redirect)", async () => {
    h.gate = "required";
    expect(await ackAlertAction("org", null, form())).toEqual({ ok: false, error: expect.stringMatching(/two-factor/) });
    expect(h.ack).not.toHaveBeenCalled();
  });

  it("rejects an alert that isn't this team's", async () => {
    h.deliveries = [];
    expect(await ackAlertAction("org", null, form())).toEqual({ ok: false, error: expect.stringMatching(/isn't one of your team's/) });
  });

  it("acks every node under the shared alert id, then records it", async () => {
    expect(await ackAlertAction("org", null, form())).toEqual({ ok: true });
    expect(h.ack).toHaveBeenCalledTimes(2);
    expect(h.ack).toHaveBeenCalledWith(expect.objectContaining({ name: "avserv-2.rmdig.ai" }), "sub:team", expect.objectContaining({ teamId: "org", by: "portal-user:u1" }));
    expect(h.ack).toHaveBeenCalledWith(expect.objectContaining({ name: "avserv-3.rmdig.ai" }), "sub:team", expect.anything());
    expect(h.ack.mock.calls[0]![2]).toEqual({ teamId: "org", by: "portal-user:u1" });
    expect(h.acks).toEqual([expect.objectContaining({ orgId: "org", alertId: "sub:team", ackedByUserId: "u1" })]);
  });

  it("records the earliest ack time AvServ returns, not the portal's clock", async () => {
    h.ack.mockResolvedValueOnce({ ok: true, first: false, at: "2026-10-05T19:00:09Z" }).mockResolvedValueOnce({ ok: true, first: true, at: "2026-10-05T19:00:01Z" });
    await ackAlertAction("org", null, form());
    expect(h.acks).toEqual([expect.objectContaining({ ackedAt: new Date("2026-10-05T19:00:01Z") })]);
  });

  it("records it when one node fails, logging the failure loudly", async () => {
    h.ack.mockResolvedValueOnce({ ok: false, code: "unreachable" });
    expect(await ackAlertAction("org", null, form())).toEqual({ ok: true });
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "sar.ack.node_failed", code: "unreachable" }));
    expect(h.acks).toHaveLength(1);
  });

  it("fails (and records nothing) when every node fails", async () => {
    h.ack.mockResolvedValue({ ok: false, code: "http_500" });
    expect(await ackAlertAction("org", null, form())).toEqual({ ok: false, error: expect.stringMatching(/Couldn't record/) });
    expect(h.acks).toEqual([]);
  });
});
