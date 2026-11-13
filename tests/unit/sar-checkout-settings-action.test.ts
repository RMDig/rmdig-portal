import { beforeEach, describe, expect, it, vi } from "vitest";

// A team's admins set its check-out settings (plan 33 9.7 D5, 9.8 D4): the cap
// and who may name the team. Admins only, any live status, validated as
// AvServ would, saved with a settings-log row in one transaction, then synced.
// A failed sync is surfaced, never rolled back; a pending team's settings wait
// for approval.

const h = vi.hoisted(() => ({
  userId: "admin-1" as string | undefined,
  canManage: true,
  locked: { status: "approved", cap: null, mode: "open" } as { status: string; cap: number | null; mode: string } | undefined,
  updates: [] as unknown[],
  inserts: [] as unknown[],
  txError: null as unknown,
  sync: vi.fn(),
  revalidate: vi.fn(),
  reportError: vi.fn(),
  reportProblem: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/db", () => {
  const tx = {
    select: () => {
      const c: Record<string, unknown> = {};
      for (const m of ["from", "where", "for"]) c[m] = () => c;
      c.limit = () => Promise.resolve(h.locked ? [h.locked] : []);
      return c;
    },
    update: () => ({ set: (v: unknown) => ({ where: () => { h.updates.push(v); return Promise.resolve(); } }) }),
    insert: () => ({ values: (v: unknown) => { h.inserts.push(v); return Promise.resolve(); } }),
  };
  return {
    db: {
      transaction: async (cb: (t: typeof tx) => unknown) => {
        if (h.txError) throw h.txError;
        return cb(tx);
      },
    },
  };
});
vi.mock("@/lib/auth", () => ({ auth: () => Promise.resolve(h.userId ? { user: { id: h.userId } } : null) }));
vi.mock("@/lib/auth/mfa-gate", () => ({ userMfaGate: () => Promise.resolve({ gate: "ok", roles: [] }) }));
vi.mock("@/lib/auth/org-roles", () => ({ canManageOrg: () => Promise.resolve(h.canManage) }));
vi.mock("@/lib/sar/sync", () => ({ syncSarOrg: h.sync }));
vi.mock("@/lib/report-error", () => ({ reportError: h.reportError, reportProblem: h.reportProblem }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidate }));

import { saveAcceptanceModeAction, saveCapacityAction } from "@/app/(portal)/sar/[orgId]/checkouts/actions";

const ORG = "11111111-1111-4111-8111-111111111111";
const form = (k: string, v: string) => {
  const f = new FormData();
  f.set(k, v);
  return f;
};
const saveCap = (v: string) => saveCapacityAction(ORG, null, form("maxActiveCheckouts", v));
const saveMode = (v: string) => saveAcceptanceModeAction(ORG, null, form("acceptanceMode", v));

beforeEach(() => {
  vi.clearAllMocks();
  h.userId = "admin-1";
  h.canManage = true;
  h.locked = { status: "approved", cap: null, mode: "open" };
  h.updates = [];
  h.inserts = [];
  h.txError = null;
  h.sync.mockResolvedValue([{ node: "avserv-2", outcome: "ok" }, { node: "avserv-3", outcome: "ok" }]);
});

describe("saveCapacityAction (9.7)", () => {
  it("saves the cap with a log row of old and new, and syncs it to every node", async () => {
    expect(await saveCap("25")).toEqual({ ok: true, value: 25, sync: "sent" });
    expect(h.updates).toEqual([{ maxActiveCheckouts: 25 }]);
    expect(h.inserts).toEqual([{ orgId: ORG, setting: "max_active_checkouts", fromValue: null, toValue: "25", actorUserId: "admin-1" }]);
    expect(h.sync).toHaveBeenCalledWith(ORG);
    expect(h.revalidate).toHaveBeenCalledWith(`/sar/${ORG}`, "layout");
  });

  it("clears the cap back to no limit, logged", async () => {
    h.locked = { status: "leaving", cap: 25, mode: "open" };
    expect(await saveCap("")).toEqual({ ok: true, value: null, sync: "sent" });
    expect(h.inserts).toEqual([expect.objectContaining({ fromValue: "25", toValue: null })]);
  });

  it("changes nothing, logs nothing and sends nothing when the cap is already that", async () => {
    h.locked = { status: "approved", cap: 25, mode: "open" };
    expect(await saveCap("25")).toEqual({ ok: true, value: 25, sync: "unchanged" });
    expect([h.updates, h.inserts]).toEqual([[], []]);
    expect(h.sync).not.toHaveBeenCalled();
  });

  it("refuses a value AvServ would refuse, before touching the database", async () => {
    expect(await saveCap("0")).toEqual({
      ok: false,
      error: "Enter a number from 1 to 10,000, or leave it blank for no limit.",
      fieldError: "Enter a number from 1 to 10,000, or leave it blank for no limit.",
    });
    expect((await saveCap("2.5")).ok).toBe(false);
    expect(h.updates).toEqual([]);
  });
});

describe("saveAcceptanceModeAction (9.8)", () => {
  it("turns on approvals, logged and synced", async () => {
    expect(await saveMode("confirm_first")).toEqual({ ok: true, value: "confirm_first", sync: "sent" });
    expect(h.updates).toEqual([{ acceptanceMode: "confirm_first" }]);
    expect(h.inserts).toEqual([{ orgId: ORG, setting: "acceptance_mode", fromValue: "open", toValue: "confirm_first", actorUserId: "admin-1" }]);
  });

  it("turns approvals off again", async () => {
    h.locked = { status: "approved", cap: null, mode: "confirm_first" };
    expect(await saveMode("open")).toEqual({ ok: true, value: "open", sync: "sent" });
    expect(h.inserts).toEqual([expect.objectContaining({ fromValue: "confirm_first", toValue: "open" })]);
  });

  it("refuses an unknown mode before touching the database", async () => {
    expect(await saveMode("vip_only")).toEqual({ ok: false, error: "Choose who can name your team." });
    expect(h.updates).toEqual([]);
  });
});

describe("both settings", () => {
  it("keep a pending team's setting for later, without syncing a team AvServ doesn't have yet", async () => {
    h.locked = { status: "pending", cap: null, mode: "open" };
    expect(await saveCap("10")).toEqual({ ok: true, value: 10, sync: "later" });
    expect(await saveMode("confirm_first")).toEqual({ ok: true, value: "confirm_first", sync: "later" });
    expect(h.sync).not.toHaveBeenCalled();
  });

  it("refuse anyone but the team's admins, and anyone signed out", async () => {
    h.canManage = false;
    expect(await saveCap("25")).toEqual({ ok: false, error: "Only your team's admins can change its check-out settings." });
    expect((await saveMode("confirm_first")).ok).toBe(false);
    h.userId = undefined;
    expect((await saveCap("25")).ok).toBe(false);
    expect(h.updates).toEqual([]);
  });

  it("refuse a team that is over (rejected or withdrawn), checked under the lock", async () => {
    h.locked = { status: "withdrawn", cap: null, mode: "open" };
    expect(await saveCap("5")).toEqual({ ok: false, error: "This team isn't taking part any more, so it has no check-out settings." });
    h.locked = undefined;
    expect((await saveMode("confirm_first")).ok).toBe(false);
    expect(h.updates).toEqual([]);
  });

  it("say so loudly when a node didn't take it, keeping the saved setting", async () => {
    h.sync.mockResolvedValue([{ node: "avserv-2", outcome: "ok" }, { node: "avserv-3", outcome: "error", code: "capacity_invalid" }]);
    expect(await saveCap("25")).toEqual({ ok: true, value: 25, sync: "partial" });
    expect(h.reportProblem).toHaveBeenCalledWith("sar.settings.sync_incomplete", expect.any(String), {
      orgId: ORG,
      setting: "max_active_checkouts",
      outcomes: "avserv-2:ok,avserv-3:capacity_invalid",
    });
    h.sync.mockRejectedValue(new Error("db blip"));
    expect(await saveMode("confirm_first")).toEqual({ ok: true, value: "confirm_first", sync: "partial" });
    expect(h.reportError).toHaveBeenCalledWith("sar.settings.sync_failed", expect.any(Error), { orgId: ORG, setting: "acceptance_mode" });
  });

  it("fail loudly when the save itself fails", async () => {
    h.txError = new Error("db down");
    expect(await saveCap("25")).toEqual({ ok: false, error: "Couldn't save the setting. Try again in a moment." });
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "sar.settings.save_failed", setting: "max_active_checkouts" }));
  });
});
