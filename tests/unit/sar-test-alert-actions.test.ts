import { beforeEach, describe, expect, it, vi } from "vitest";

// The test alert's actions (plan 33 §6.9 G2 item 3): staff send it under the
// approver's rules; the team's admins and dispatchers prove each path.

const h = vi.hoisted(() => ({
  approver: true,
  role: null as string | null,
  gate: "ok",
  org: [] as unknown[],
  latest: [] as Array<{ requestedAt: string }>,
  send: vi.fn(),
  mark: vi.fn(),
  confirm: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/auth/mfa-gate", () => ({ userMfaGate: () => Promise.resolve({ gate: h.gate, roles: [] }) }));
vi.mock("@/lib/auth/roles", () => ({ isSarApprover: () => Promise.resolve(h.approver) }));
vi.mock("@/lib/auth/org-roles", () => ({ getOrgRole: () => Promise.resolve(h.role) }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/sar/test-alert", () => ({
  latestTestAlert: () => Promise.resolve(h.latest),
  sendTestAlerts: h.send,
  markTestReceived: h.mark,
  confirmTestCode: h.confirm,
}));
vi.mock("@/lib/db", () => {
  const sel: Record<string, unknown> = {};
  sel.from = () => sel;
  sel.where = () => sel;
  sel.limit = () => Promise.resolve(h.org);
  return { db: { select: () => sel } };
});

import { sendTestAlertAction } from "@/app/(portal)/admin/sar-approvals/test-alert-actions";
import { confirmTestCodeAction, markTestReceivedAction } from "@/app/(portal)/sar/[orgId]/alerts/test-alert-actions";
import { auth } from "@/lib/auth";

const ORG = "11111111-1111-4111-8111-111111111111";
const ROW = "22222222-2222-4222-8222-222222222222";
const team = (o: Record<string, unknown> = {}) => ({
  id: ORG,
  name: "Summit County SAR",
  status: "pending",
  isDrill: false,
  createdByUserId: "submitter-1",
  oncallEmail: "oncall@summitsar.org",
  oncallEmailVerifiedAt: new Date(),
  ...o,
});
const fd = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "staff-1" } } as never);
  h.approver = true;
  h.role = null;
  h.gate = "ok";
  h.org = [team()];
  h.latest = [];
  h.send.mockResolvedValue({ ok: true, nodes: 2, failed: [] });
  h.mark.mockResolvedValue({ ok: true });
  h.confirm.mockResolvedValue({ ok: true });
});

describe("sendTestAlertAction", () => {
  const send = () => sendTestAlertAction(null, fd({ orgId: ORG }));

  it("sends from every node for a pending real team, and says what to do next", async () => {
    expect(await send()).toEqual({ ok: true, message: "Sent from 2 nodes. Ask the team to confirm each message on its Alerts page." });
    expect(h.send).toHaveBeenCalledWith(expect.objectContaining({ id: ORG, name: "Summit County SAR", isDrill: false }), "staff-1");
  });

  it("says which nodes failed, and fails loud when none sent", async () => {
    h.send.mockResolvedValue({ ok: true, nodes: 2, failed: ["avserv-3.rmdig.ai"] });
    expect(await send()).toMatchObject({ ok: true, message: expect.stringContaining("Sent from 1 of 2 nodes; avserv-3.rmdig.ai failed") });
    h.send.mockResolvedValue({ ok: true, nodes: 2, failed: ["avserv-2.rmdig.ai", "avserv-3.rmdig.ai"] });
    expect(await send()).toMatchObject({ ok: false, error: expect.stringContaining("No node sent the test") });
    h.send.mockResolvedValue({ ok: false, error: "No AvServ nodes are configured (AVSERV_NODE_URLS), so no test can be sent." });
    expect(await send()).toMatchObject({ ok: false, error: expect.stringContaining("AVSERV_NODE_URLS") });
  });

  it("refuses anyone but a SAR approver, and an approver without MFA", async () => {
    h.approver = false;
    expect(await send()).toEqual({ ok: false, error: "You don't have access to the approvals queue." });
    h.approver = true;
    h.gate = "required";
    expect(await send()).toMatchObject({ ok: false });
    expect(h.send).not.toHaveBeenCalled();
  });

  it("refuses the org's submitter or a member (the approver's conflict rule)", async () => {
    h.org = [team({ createdByUserId: "staff-1" })];
    expect(await send()).toMatchObject({ ok: false, error: expect.stringContaining("another approver") });
    h.org = [team()];
    h.role = "responder";
    expect(await send()).toMatchObject({ ok: false, error: expect.stringContaining("another approver") });
    expect(h.send).not.toHaveBeenCalled();
  });

  it("refuses a drill team, a team past review, an unknown org, and a bad id", async () => {
    h.org = [team({ isDrill: true })];
    expect(await send()).toMatchObject({ ok: false, error: expect.stringContaining("drill team") });
    h.org = [team({ status: "approved" })];
    expect(await send()).toMatchObject({ ok: false, error: expect.stringContaining("approved") });
    h.org = [];
    expect(await send()).toMatchObject({ ok: false, error: "That organization no longer exists." });
    expect(await sendTestAlertAction(null, fd({ orgId: "nope" }))).toEqual({ ok: false, error: "Unknown organization." });
    expect(h.send).not.toHaveBeenCalled();
  });

  it("won't spend a second test on a double click", async () => {
    h.latest = [{ requestedAt: new Date(Date.now() - 10_000).toISOString() }];
    expect(await send()).toMatchObject({ ok: false, error: expect.stringContaining("less than a minute ago") });
    h.latest = [{ requestedAt: new Date(Date.now() - 120_000).toISOString() }];
    expect(await send()).toMatchObject({ ok: true });
  });
});

describe("the team's proof", () => {
  beforeEach(() => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "member-1" } } as never);
    h.role = "dispatcher";
  });

  it("marks a node's message received for an admin or dispatcher", async () => {
    expect(await markTestReceivedAction(ORG, null, fd({ testAlertId: ROW }))).toEqual({ ok: true });
    expect(h.mark).toHaveBeenCalledWith(ORG, ROW, "member-1");
  });

  it("passes on the store's refusal (not arrived, already marked)", async () => {
    h.mark.mockResolvedValue({ ok: false, error: "That test message hasn't arrived, or it's already marked received." });
    expect(await markTestReceivedAction(ORG, null, fd({ testAlertId: ROW }))).toMatchObject({ ok: false });
  });

  it("confirms a six-digit code, trimmed", async () => {
    expect(await confirmTestCodeAction(ORG, null, fd({ testAlertId: ROW, code: " 482915 " }))).toEqual({ ok: true });
    expect(h.confirm).toHaveBeenCalledWith(ORG, ROW, "482915", "member-1");
  });

  it("refuses a malformed code or id before the store sees it", async () => {
    expect(await confirmTestCodeAction(ORG, null, fd({ testAlertId: ROW, code: "48a" }))).toEqual({ ok: false, error: "Enter the six digits from the test email." });
    expect(await confirmTestCodeAction(ORG, null, fd({ testAlertId: "x", code: "482915" }))).toEqual({ ok: false, error: "Unknown test." });
    expect(h.confirm).not.toHaveBeenCalled();
  });

  it("refuses a responder and a non-member", async () => {
    for (const role of ["responder", null]) {
      h.role = role;
      expect(await markTestReceivedAction(ORG, null, fd({ testAlertId: ROW }))).toMatchObject({ ok: false, error: expect.stringContaining("admins and dispatchers") });
      expect(await confirmTestCodeAction(ORG, null, fd({ testAlertId: ROW, code: "482915" }))).toMatchObject({ ok: false });
    }
    expect(h.mark).not.toHaveBeenCalled();
    expect(h.confirm).not.toHaveBeenCalled();
  });
});
