import { beforeEach, describe, expect, it, vi } from "vitest";

// A team's own leaving notice and its undo (lib/sar/leaving.ts; plan 33 §6.9):
// a guarded change and its log row, then the sync and the staff email, which
// never undo it.

const h = vi.hoisted(() => ({
  org: [] as unknown[],
  updated: [{ id: "org-1" }] as unknown[],
  updates: [] as unknown[],
  logs: [] as unknown[],
  sync: vi.fn(),
  staff: vi.fn(),
  send: vi.fn(),
  problem: vi.fn(),
  error: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/db", () => {
  const sel: Record<string, unknown> = {};
  sel.from = () => sel;
  sel.innerJoin = () => sel;
  sel.where = () => sel;
  sel.limit = () => Promise.resolve(h.org);
  const tx = {
    update: () => ({ set: (v: unknown) => (h.updates.push(v), { where: () => ({ returning: () => Promise.resolve(h.updated) }) }) }),
    insert: () => ({ values: (v: unknown) => (h.logs.push(v), Promise.resolve()) }),
  };
  return { db: { select: () => sel, transaction: (cb: (t: typeof tx) => unknown) => Promise.resolve(cb(tx)) } };
});
vi.mock("@/lib/sar/sync", () => ({ syncSarOrg: h.sync }));
vi.mock("@/lib/auth/staff-recipients", () => ({ staffEmails: h.staff }));
vi.mock("@/lib/email/send", () => ({ sendSarLeavingStaffEmail: h.send }));
vi.mock("@/lib/report-error", () => ({ reportProblem: h.problem, reportError: h.error }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));

import { changeLeaving } from "@/lib/sar/leaving";

const ORG = "11111111-1111-4111-8111-111111111111";
const team = (status: string, o: Record<string, unknown> = {}) => [{ name: "Summit SAR", status, isDrill: false, actorEmail: "lead@summit.org", ...o }];

beforeEach(() => {
  vi.clearAllMocks();
  h.updates = [];
  h.logs = [];
  h.updated = [{ id: ORG }];
  h.org = team("approved");
  h.sync.mockResolvedValue([{ node: "avserv-2", outcome: "ok" }, { node: "avserv-3", outcome: "ok" }]);
  h.staff.mockResolvedValue(["staff@rmdig.ai"]);
  h.send.mockResolvedValue(undefined);
});

describe("changeLeaving", () => {
  it("gives notice: leaving, stamped, logged as the team, synced, staff told", async () => {
    expect(await changeLeaving(ORG, "u1", "give_notice")).toEqual({ ok: true, synced: true });
    expect(h.updates[0]).toMatchObject({ status: "leaving", leavingNoticeAt: expect.any(Date) });
    expect(h.logs[0]).toEqual({ orgId: ORG, action: "leaving", fromStatus: "approved", toStatus: "leaving", note: "By the team", actorUserId: "u1" });
    expect(h.sync).toHaveBeenCalledWith(ORG);
    expect(h.send).toHaveBeenCalledWith("staff@rmdig.ai", expect.objectContaining({ orgName: "Summit SAR", actorEmail: "lead@summit.org", change: "give_notice", orgUrl: expect.stringContaining(`/admin/sar-approvals#org-${ORG}`) }));
  });

  it("undoes: approved again, the stamp cleared, logged leaving_undone", async () => {
    h.org = team("leaving");
    expect(await changeLeaving(ORG, "u1", "undo")).toEqual({ ok: true, synced: true });
    expect(h.updates[0]).toMatchObject({ status: "approved", leavingNoticeAt: null });
    expect(h.logs[0]).toMatchObject({ action: "leaving_undone", fromStatus: "leaving", toStatus: "approved" });
  });

  it("refuses from the wrong status, changing nothing", async () => {
    for (const [status, change] of [["leaving", "give_notice"], ["approved", "undo"], ["suspended", "give_notice"], ["withdrawn", "undo"]] as const) {
      h.org = team(status);
      expect(await changeLeaving(ORG, "u1", change)).toMatchObject({ ok: false });
    }
    expect(h.updates).toHaveLength(0);
    expect(h.sync).not.toHaveBeenCalled();
  });

  it("refuses when the status changed under it (staff or another admin first)", async () => {
    h.updated = [];
    expect(await changeLeaving(ORG, "u1", "give_notice")).toEqual({ ok: false, error: "Your team's status changed just now. Reload the page." });
    expect(h.logs).toHaveLength(0);
    expect(h.sync).not.toHaveBeenCalled();
  });

  it("keeps the change when a node misses it, and says so loudly", async () => {
    h.sync.mockResolvedValue([{ node: "avserv-2", outcome: "ok" }, { node: "avserv-3", outcome: "error" }]);
    expect(await changeLeaving(ORG, "u1", "give_notice")).toEqual({ ok: true, synced: false });
    expect(h.problem).toHaveBeenCalledWith("sar.leaving.sync_incomplete", expect.any(String), expect.objectContaining({ outcomes: "avserv-2:ok,avserv-3:error" }));
    h.sync.mockRejectedValue(new Error("boom"));
    h.updates = [];
    expect(await changeLeaving(ORG, "u1", "give_notice")).toEqual({ ok: true, synced: false });
    expect(h.error).toHaveBeenCalledWith("sar.leaving.sync_failed", expect.any(Error), expect.anything());
  });

  it("links a drill team's own page, and survives a failed staff email", async () => {
    h.org = team("approved", { isDrill: true });
    h.send.mockRejectedValue(new Error("resend down"));
    expect(await changeLeaving(ORG, "u1", "give_notice")).toMatchObject({ ok: true });
    expect(h.send).toHaveBeenCalledWith("staff@rmdig.ai", expect.objectContaining({ drill: true, orgUrl: expect.stringContaining("/admin/sar-drill") }));
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "sar.leaving.staff_email_failed" }));
  });
});
