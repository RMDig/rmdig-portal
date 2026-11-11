import { beforeEach, describe, expect, it, vi } from "vitest";

// activateDrillOrgAction (plan 37 §4.6, owner decision DR1; CLAUDE.md §0's one
// exception): a user with both rmdig_admin and rmdig_sar_approver takes a
// pending DRILL team to approved, even one they registered, logged
// drill_activated "not an independent review", then synced. Never a real team.

const h = vi.hoisted(() => ({
  actor: { ok: true, userId: "op-1" } as { ok: true; userId: string } | { ok: false; error: string },
  admin: true,
  approver: true,
  org: [{ isDrill: true, status: "pending", reviewRevision: 4 }] as unknown[],
  admins: [{ userId: "drill-admin" }] as unknown[],
  updated: [{ id: "org" }] as unknown[],
  updates: [] as Array<Record<string, unknown>>,
  logs: [] as Array<Record<string, unknown>>,
  txError: null as unknown,
  sync: vi.fn(),
  reportError: vi.fn(),
  revalidate: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/auth/portal-actor", () => ({ portalActor: () => Promise.resolve(h.actor) }));
vi.mock("@/lib/auth/roles", () => ({
  hasPlatformRole: (_u: string, r: string) => Promise.resolve(r === "rmdig_admin" && h.admin),
  isSarApprover: () => Promise.resolve(h.approver),
}));
vi.mock("@/lib/sar/sync", () => ({ syncSarOrg: h.sync }));
vi.mock("@/lib/report-error", () => ({ reportError: h.reportError }));
vi.mock("@/lib/email/send", () => ({ sendDrillLoginEmail: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidate }));
vi.mock("@/lib/db", () => {
  const name = (t: Record<symbol, string>) => t[Symbol.for("drizzle:Name")] ?? "";
  const select = () => {
    let table = "";
    const c: Record<string, unknown> = {};
    c.from = (t: Record<symbol, string>) => {
      table = name(t);
      return c;
    };
    c.where = () => c;
    c.limit = () => Promise.resolve(table === "sar_orgs" ? h.org : h.admins);
    return c;
  };
  const tx = {
    update: () => ({
      set: (v: Record<string, unknown>) => {
        h.updates.push(v);
        return { where: () => ({ returning: () => Promise.resolve(h.updated) }) };
      },
    }),
    insert: () => ({ values: (v: Record<string, unknown>) => { h.logs.push(v); return Promise.resolve(); } }),
  };
  return {
    db: {
      select,
      transaction: async (cb: (t: typeof tx) => unknown) => {
        if (h.txError) throw h.txError;
        return cb(tx);
      },
    },
  };
});

import { activateDrillOrgAction } from "@/app/(portal)/admin/sar-drill/actions";
import { DRILL_ACTIVATED_NOTE } from "@/lib/sar/drill";

const ORG = "11111111-1111-4111-8111-111111111111";
const form = (revision = 4) => {
  const f = new FormData();
  f.set("orgId", ORG);
  f.set("revision", String(revision));
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  h.actor = { ok: true, userId: "op-1" };
  h.admin = true;
  h.approver = true;
  h.org = [{ isDrill: true, status: "pending", reviewRevision: 4 }];
  h.admins = [{ userId: "drill-admin" }];
  h.updated = [{ id: "org" }];
  h.updates = [];
  h.logs = [];
  h.txError = null;
  h.sync.mockResolvedValue([]);
});

describe("activateDrillOrgAction", () => {
  it("approves the drill team with the approval fields the sync needs, logs drill_activated, and syncs", async () => {
    expect(await activateDrillOrgAction(null, form())).toEqual({ ok: true });
    expect(h.updates[0]).toMatchObject({ status: "approved", approvedAt: expect.any(Date), approvedByUserId: "op-1", reviewNote: null });
    expect(h.logs).toEqual([
      { orgId: ORG, action: "drill_activated", fromStatus: "pending", toStatus: "approved", note: DRILL_ACTIVATED_NOTE, actorUserId: "op-1" },
    ]);
    expect(DRILL_ACTIVATED_NOTE).toBe("drill org activated by the operator; not an independent review");
    expect(h.sync).toHaveBeenCalledWith(ORG);
    expect(h.revalidate).toHaveBeenCalledWith("/admin/sar-drill");
  });

  it("needs both roles, and a signed-in user", async () => {
    h.approver = false;
    expect(await activateDrillOrgAction(null, form())).toMatchObject({ ok: false, error: expect.stringContaining("both") });
    h.approver = true;
    h.admin = false;
    expect(await activateDrillOrgAction(null, form())).toMatchObject({ ok: false, error: expect.stringContaining("both") });
    h.actor = { ok: false, error: "Sign in again." };
    expect(await activateDrillOrgAction(null, form())).toEqual({ ok: false, error: "Sign in again." });
    expect(h.updates).toEqual([]);
    expect(h.sync).not.toHaveBeenCalled();
  });

  it("never activates a real team, and says where real teams are approved", async () => {
    h.org = [{ isDrill: false, status: "pending", reviewRevision: 4 }];
    expect(await activateDrillOrgAction(null, form())).toMatchObject({ ok: false, error: expect.stringContaining("Only a drill team") });
    expect(h.log.warn).toHaveBeenCalledWith({ event: "sar.drill.activate_real_refused", userId: "op-1", orgId: ORG });
    expect(h.updates).toEqual([]);
  });

  it("only activates a pending drill team the operator has seen as it is", async () => {
    h.org = [{ isDrill: true, status: "approved", reviewRevision: 4 }];
    expect(await activateDrillOrgAction(null, form())).toMatchObject({ ok: false, error: expect.stringContaining("approved") });
    h.org = [{ isDrill: true, status: "pending", reviewRevision: 5 }];
    expect(await activateDrillOrgAction(null, form())).toMatchObject({ ok: false, error: expect.stringContaining("changed") });
    // Changed between the read and the write: nothing is logged or synced.
    h.org = [{ isDrill: true, status: "pending", reviewRevision: 4 }];
    h.updated = [];
    expect(await activateDrillOrgAction(null, form())).toMatchObject({ ok: false, error: expect.stringContaining("changed") });
    expect(h.logs).toEqual([]);
    expect(h.sync).not.toHaveBeenCalled();
  });

  it("needs a drill login with the admin role first", async () => {
    h.admins = [];
    expect(await activateDrillOrgAction(null, form())).toEqual({ ok: false, error: "Add a drill login with the admin role before activating." });
    expect(h.updates).toEqual([]);
  });

  it("refuses an unreadable form", async () => {
    const f = new FormData();
    f.set("orgId", "nope");
    f.set("revision", "4");
    expect(await activateDrillOrgAction(null, f)).toEqual({ ok: false, error: "That drill team couldn't be found." });
  });

  it("fails loud when the write fails, and keeps the activation when the sync throws", async () => {
    h.txError = new Error("db down");
    expect(await activateDrillOrgAction(null, form())).toMatchObject({ ok: false, error: expect.stringContaining("Couldn't activate") });
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "sar.drill.activate_failed" }));
    h.txError = null;
    h.sync.mockRejectedValue(new Error("boom"));
    expect(await activateDrillOrgAction(null, form())).toEqual({ ok: true });
    expect(h.reportError).toHaveBeenCalledWith("sar.sync.failed", expect.any(Error), { orgId: ORG, decision: "activate_drill" });
  });
});
