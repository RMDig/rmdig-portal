import { beforeEach, describe, expect, it, vi } from "vitest";

// The on-call email channel (plan 33 9.10; G1): a team admin proposes an
// address and a link goes to it; whoever reads that inbox confirms it, with
// no sign-in, and the team is synced. Nothing changes until it's confirmed.

const h = vi.hoisted(() => ({
  actor: { ok: true, userId: "admin-1" } as { ok: true; userId: string } | { ok: false; error: string },
  canManage: true,
  org: [] as unknown[],
  deletes: 0,
  inserts: [] as Array<Record<string, unknown>>,
  txError: null as unknown,
  allowed: true,
  rlKeys: [] as string[],
  send: vi.fn(),
  confirm: vi.fn(),
  sync: vi.fn(),
  reportError: vi.fn(),
  revalidate: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/auth/portal-actor", () => ({ portalActor: () => Promise.resolve(h.actor) }));
vi.mock("@/lib/auth/org-roles", () => ({ canManageOrg: () => Promise.resolve(h.canManage) }));
vi.mock("@/lib/db", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where"]) chain[m] = () => chain;
  chain.limit = () => Promise.resolve(h.org);
  const tx = {
    delete: () => ({ where: () => { h.deletes++; return Promise.resolve(); } }),
    insert: () => ({ values: (v: Record<string, unknown>) => { h.inserts.push(v); return Promise.resolve(); } }),
  };
  return {
    db: {
      select: () => chain,
      transaction: async (cb: (t: typeof tx) => unknown) => {
        if (h.txError) throw h.txError;
        return cb(tx);
      },
    },
  };
});
vi.mock("@/lib/email/send", () => ({ sendOncallEmailConfirmEmail: h.send }));
vi.mock("@/lib/rate-limit", () => ({
  incrementRateLimit: (key: string) => {
    h.rlKeys.push(key);
    return Promise.resolve({ allowed: h.allowed });
  },
}));
vi.mock("@/lib/client-ip", () => ({ clientIp: () => Promise.resolve("203.0.113.9") }));
vi.mock("@/lib/sar/oncall-confirm", async () => ({ ...(await vi.importActual<object>("@/lib/sar/oncall-confirm")), confirmOncallLink: h.confirm }));
vi.mock("@/lib/sar/sync", () => ({ syncSarOrg: h.sync }));
vi.mock("@/lib/report-error", () => ({ reportError: h.reportError }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidate }));

import { confirmOncallEmailAction } from "@/app/(auth)/oncall-verify/actions";
import { requestOncallEmailAction } from "@/app/(portal)/sar/[orgId]/terms/oncall-actions";
import { hashOncallToken } from "@/lib/sar/oncall-email";

const ORG = "11111111-1111-4111-8111-111111111111";
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  h.actor = { ok: true, userId: "admin-1" };
  h.canManage = true;
  h.org = [{ name: "Summit SAR", status: "approved", isDrill: false, oncallEmail: null }];
  h.deletes = 0;
  h.inserts = [];
  h.txError = null;
  h.allowed = true;
  h.rlKeys = [];
  h.send.mockResolvedValue(undefined);
  h.sync.mockResolvedValue([]);
});

describe("requestOncallEmailAction", () => {
  it("replaces any open request, stores only the token's hash, and emails the link to the address", async () => {
    expect(await requestOncallEmailAction(ORG, null, form({ address: " Dispatch@SummitRescue.org " }))).toEqual({ ok: true, address: "dispatch@summitrescue.org" });
    expect(h.deletes).toBe(1);
    expect(h.inserts[0]).toMatchObject({ orgId: ORG, address: "dispatch@summitrescue.org", requestedByUserId: "admin-1", expires: expect.any(Date) });
    const [to, params] = h.send.mock.calls[0] as [string, { teamName: string; confirmUrl: string; expiresInHours: number; drill: boolean }];
    expect(to).toBe("dispatch@summitrescue.org");
    expect(params).toMatchObject({ teamName: "Summit SAR", expiresInHours: 24, drill: false });
    const token = new URL(params.confirmUrl).searchParams.get("token")!;
    expect(new URL(params.confirmUrl).pathname).toBe("/oncall-verify");
    expect(h.inserts[0]!.tokenHash).toBe(hashOncallToken(token));
    expect(JSON.stringify(h.inserts)).not.toContain(token);
    expect(h.rlKeys).toEqual([`oncall-link:${ORG}`]);
  });

  it("marks a drill team's link as a drill", async () => {
    h.org = [{ name: "AvAI Drill Team", status: "approved", isDrill: true, oncallEmail: null }];
    await requestOncallEmailAction(ORG, null, form({ address: "dennys+drill1@rmdig.ai" }));
    expect(h.send).toHaveBeenCalledWith("dennys+drill1@rmdig.ai", expect.objectContaining({ drill: true }));
  });

  it("refuses anyone who isn't the team's admin, a closed team, a bad address, and the current address", async () => {
    h.canManage = false;
    expect(await requestOncallEmailAction(ORG, null, form({ address: "a@b.org" }))).toMatchObject({ ok: false, error: expect.stringContaining("admins") });
    h.canManage = true;
    h.org = [{ name: "S", status: "suspended", isDrill: false, oncallEmail: null }];
    expect(await requestOncallEmailAction(ORG, null, form({ address: "a@b.org" }))).toMatchObject({ ok: false, error: expect.stringContaining("suspended") });
    h.org = [{ name: "S", status: "approved", isDrill: false, oncallEmail: "a@b.org" }];
    expect(await requestOncallEmailAction(ORG, null, form({ address: "not an email" }))).toMatchObject({ ok: false, fieldErrors: { address: expect.any(Array) } });
    expect(await requestOncallEmailAction(ORG, null, form({ address: "A@B.org" }))).toMatchObject({ ok: false, error: expect.stringContaining("already") });
    expect(h.inserts).toEqual([]);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("stops at five links a day, before writing or emailing", async () => {
    h.allowed = false;
    expect(await requestOncallEmailAction(ORG, null, form({ address: "a@b.org" }))).toMatchObject({ ok: false, error: expect.stringContaining("5 confirmation links") });
    expect(h.inserts).toEqual([]);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("says so loudly when the save or the email fails", async () => {
    h.txError = new Error("reset");
    expect(await requestOncallEmailAction(ORG, null, form({ address: "a@b.org" }))).toMatchObject({ ok: false, error: expect.stringContaining("Couldn't save") });
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "sar.oncall.request_failed" }));
    h.txError = null;
    h.send.mockRejectedValue(new Error("resend down"));
    expect(await requestOncallEmailAction(ORG, null, form({ address: "a@b.org" }))).toMatchObject({ ok: false, error: expect.stringContaining("Couldn't send") });
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "sar.oncall.email_failed" }));
  });
});

describe("confirmOncallEmailAction (no sign-in)", () => {
  const TOKEN = "a".repeat(64);

  it("confirms the address and syncs the team to AvServ", async () => {
    h.confirm.mockResolvedValue({ ok: true, verificationId: "v1", orgId: ORG, teamName: "Summit SAR", address: "dispatch@summitrescue.org", isDrill: false });
    expect(await confirmOncallEmailAction(null, form({ token: TOKEN }))).toEqual({ ok: true, teamName: "Summit SAR", address: "dispatch@summitrescue.org" });
    expect(h.confirm).toHaveBeenCalledWith(TOKEN);
    expect(h.sync).toHaveBeenCalledWith(ORG);
    expect(h.rlKeys).toEqual(["oncall-confirm-ip:203.0.113.9"]);
  });

  it("says why a link doesn't work, and syncs nothing", async () => {
    for (const reason of ["invalid", "used", "expired", "team_closed"] as const) {
      h.confirm.mockResolvedValueOnce({ ok: false, reason });
      expect(await confirmOncallEmailAction(null, form({ token: TOKEN }))).toMatchObject({ ok: false, error: expect.any(String) });
    }
    expect(h.sync).not.toHaveBeenCalled();
  });

  it("keeps a confirmation when the sync throws, and reports it", async () => {
    h.confirm.mockResolvedValue({ ok: true, verificationId: "v1", orgId: ORG, teamName: "S", address: "a@b.org", isDrill: false });
    h.sync.mockRejectedValue(new Error("no nodes"));
    expect(await confirmOncallEmailAction(null, form({ token: TOKEN }))).toMatchObject({ ok: true });
    expect(h.reportError).toHaveBeenCalledWith("sar.sync.failed", expect.any(Error), { orgId: ORG, decision: "oncall_confirmed" });
  });

  it("stops by IP before reading the token, and fails loud on a database error", async () => {
    h.allowed = false;
    expect(await confirmOncallEmailAction(null, form({ token: TOKEN }))).toMatchObject({ ok: false, error: expect.stringContaining("Too many") });
    expect(h.confirm).not.toHaveBeenCalled();
    h.allowed = true;
    h.confirm.mockRejectedValue(new Error("reset"));
    expect(await confirmOncallEmailAction(null, form({ token: TOKEN }))).toMatchObject({ ok: false, error: expect.stringContaining("Couldn't confirm") });
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "sar.oncall.confirm_failed" }));
  });
});
