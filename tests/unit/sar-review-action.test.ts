import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  org: [] as Array<{
    orgType?: string;
    status: string;
    name: string;
    submitterEmail: string;
    createdByUserId: string;
    reviewRevision: number;
  }>,
  staff: true,
  // The reviewer's role in the org under review, if any.
  memberRole: null as string | null,
  updates: [] as unknown[],
  // Rows the guarded UPDATE matches: [] when the status or revision moved on.
  updateRows: [{ id: "org" }] as unknown[],
  bumpedRevision: [] as boolean[],
  logs: [] as unknown[],
  sync: vi.fn(() => Promise.resolve([])),
  nodeViews: [] as Array<{ openBindings: number } | null | Error>,
}));

vi.mock("@/lib/db", () => {
  const tx = {
    update: () => ({
      set: ({ reviewRevision, ...v }: Record<string, unknown>) => ({
        where: () => ({
          returning: () => {
            h.bumpedRevision.push(reviewRevision !== undefined);
            if (h.updateRows.length > 0) h.updates.push(v);
            return Promise.resolve(h.updateRows);
          },
        }),
      }),
    }),
    insert: () => ({ values: (v: unknown) => { h.logs.push(v); return Promise.resolve(); } }),
  };
  const selChain: Record<string, unknown> = {
    from: () => selChain,
    innerJoin: () => selChain,
    where: () => selChain,
    limit: () => Promise.resolve(h.org),
  };
  return {
    db: {
      select: () => selChain,
      transaction: (cb: (t: typeof tx) => unknown) => Promise.resolve(cb(tx)),
    },
  };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/auth/mfa-gate", () => ({ userMfaGate: () => Promise.resolve({ gate: "ok", roles: [] }) }));
// h.staff: whether the caller holds rmdig_sar_approver, the queue's only gate.
vi.mock("@/lib/auth/roles", () => ({ isSarApprover: vi.fn(() => Promise.resolve(h.staff)) }));
vi.mock("@/lib/auth/org-roles", () => ({ getOrgRole: vi.fn(() => Promise.resolve(h.memberRole)) }));
vi.mock("@/lib/email/send", () => ({ sendSarOrgDecisionEmail: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/sar/sync", () => ({ syncSarOrg: h.sync }));
vi.mock("@/lib/avserv/sar-teams", () => ({
  avservNodes: () => h.nodeViews.map((_, i) => ({ name: `avserv-${i + 2}`, baseUrl: `https://avserv-${i + 2}.example` })),
  getSarTeam: (node: { name: string }) => {
    const v = h.nodeViews[Number(node.name.split("-")[1]) - 2];
    return v instanceof Error ? Promise.reject(v) : Promise.resolve(v ?? null);
  },
}));

import { auth } from "@/lib/auth";
import { sendSarOrgDecisionEmail } from "@/lib/email/send";

import { resyncSarOrgAction, reviewSarOrgAction } from "@/app/(portal)/admin/sar-approvals/actions";

const authMock = vi.mocked(auth);
const ORG_ID = "11111111-1111-4111-8111-111111111111";

const REVISION = 3;
const pendingOrg = (o: Partial<(typeof h.org)[number]> = {}) => [
  { status: "pending", name: "San Juan SAR", submitterEmail: "sub@sar.org", createdByUserId: "submitter-1", reviewRevision: REVISION, ...o },
];

function fd(decision: string, note?: string, revision: number = REVISION): FormData {
  const f = new FormData();
  f.set("orgId", ORG_ID);
  f.set("revision", String(revision));
  f.set("decision", decision);
  if (note !== undefined) f.set("note", note);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.updates = [];
  h.logs = [];
  h.nodeViews = [];
  h.org = pendingOrg();
  h.updateRows = [{ id: "org" }];
  h.bumpedRevision = [];
  h.staff = true;
  h.memberRole = null;
  authMock.mockResolvedValue({ user: { id: "admin-1" } } as never);
});

describe("reviewSarOrgAction", () => {
  it("rejects an unauthenticated caller", async () => {
    authMock.mockResolvedValue(null as never);
    expect((await reviewSarOrgAction(null, fd("approve"))).ok).toBe(false);
  });

  it("rejects a caller without rmdig_sar_approver (an admin or ad reviewer alone can't decide SAR orgs)", async () => {
    h.staff = false;
    const res = await reviewSarOrgAction(null, fd("approve"));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/access/i);
  });

  it("requires a note when rejecting", async () => {
    const res = await reviewSarOrgAction(null, fd("reject"));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.fieldErrors?.note).toBeDefined();
    expect(sendSarOrgDecisionEmail).not.toHaveBeenCalled();
  });

  it("refuses a transition from the wrong status (approve a non-pending org)", async () => {
    h.org = pendingOrg({ status: "approved" });
    const res = await reviewSarOrgAction(null, fd("approve"));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/can't approve|approved/i);
  });

  it("suspends an approved org without emailing", async () => {
    h.org = pendingOrg({ status: "approved" });
    const res = await reviewSarOrgAction(null, fd("suspend"));
    expect(res.ok).toBe(true);
    expect(sendSarOrgDecisionEmail).not.toHaveBeenCalled();
  });

  it("reactivates a suspended org without emailing", async () => {
    h.org = pendingOrg({ status: "suspended" });
    const res = await reviewSarOrgAction(null, fd("reactivate"));
    expect(res.ok).toBe(true);
    expect(sendSarOrgDecisionEmail).not.toHaveBeenCalled();
  });

  it("won't suspend an org that isn't approved", async () => {
    // org defaults to pending
    const res = await reviewSarOrgAction(null, fd("suspend"));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/can't suspend|pending/i);
  });

  it("approves and emails the submitter", async () => {
    const res = await reviewSarOrgAction(null, fd("approve"));
    expect(res.ok).toBe(true);
    expect(sendSarOrgDecisionEmail).toHaveBeenCalledWith("sub@sar.org", {
      orgName: "San Juan SAR",
      decision: "approved",
      note: undefined,
      actionUrl: expect.stringMatching(new RegExp(`/sar/${ORG_ID}/members$`)),
    });
  });

  it("rejects with a note and emails the submitter", async () => {
    const res = await reviewSarOrgAction(null, fd("reject", "Couldn't verify your registration."));
    expect(res.ok).toBe(true);
    expect(sendSarOrgDecisionEmail).toHaveBeenCalledWith("sub@sar.org", {
      orgName: "San Juan SAR",
      decision: "rejected",
      note: "Couldn't verify your registration.",
      actionUrl: undefined,
    });
  });

  it("requests changes with a note", async () => {
    const res = await reviewSarOrgAction(null, fd("request_changes", "Please add your county letter."));
    expect(res.ok).toBe(true);
    expect(sendSarOrgDecisionEmail).toHaveBeenCalledWith("sub@sar.org", {
      orgName: "San Juan SAR",
      decision: "changes_requested",
      note: "Please add your county letter.",
      actionUrl: expect.stringMatching(new RegExp(`/sar/${ORG_ID}/edit$`)),
    });
  });

  describe("only what the reviewer saw is decided (CLAUDE.md §0)", () => {
    it("requires the revision the page showed", async () => {
      const f = fd("approve");
      f.delete("revision");
      expect((await reviewSarOrgAction(null, f)).ok).toBe(false);
      expect(h.updates).toEqual([]);
    });

    it("refuses a decision on an application edited since the page loaded", async () => {
      h.org = pendingOrg({ reviewRevision: REVISION + 1 });
      const res = await reviewSarOrgAction(null, fd("approve"));
      expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/changed after you opened the page/) });
      expect(h.updates).toEqual([]);
      expect(sendSarOrgDecisionEmail).not.toHaveBeenCalled();
      expect(h.sync).not.toHaveBeenCalled();
    });

    it("fails loudly, writing nothing, when the guarded UPDATE matches no row (edited or decided in between)", async () => {
      h.updateRows = [];
      const res = await reviewSarOrgAction(null, fd("approve"));
      expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/changed after you opened the page/) });
      expect(h.logs).toEqual([]);
      expect(sendSarOrgDecisionEmail).not.toHaveBeenCalled();
      expect(h.sync).not.toHaveBeenCalled();
    });

    it("bumps the revision with every decision, so a second tab's stale form can't follow", async () => {
      expect(await reviewSarOrgAction(null, fd("request_changes", "Add the county letter."))).toEqual({ ok: true });
      expect(h.bumpedRevision).toEqual([true]);
    });

    it("refuses to let an approver approve, or re-verify, an organization they submitted", async () => {
      h.org = pendingOrg({ createdByUserId: "admin-1" });
      const res = await reviewSarOrgAction(null, fd("approve"));
      expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/You submitted this organization/) });
      h.org = pendingOrg({ createdByUserId: "admin-1", status: "approved", orgType: "ski_patrol" });
      expect(await reviewSarOrgAction(null, fd("reverify", "Called the area."))).toMatchObject({ ok: false });
      expect(h.updates).toEqual([]);
      expect(h.sync).not.toHaveBeenCalled();
    });

    it("refuses to let a member of the org (any role) approve or re-verify it", async () => {
      for (const role of ["admin", "dispatcher", "responder"]) {
        h.memberRole = role;
        h.org = pendingOrg();
        expect(await reviewSarOrgAction(null, fd("approve"))).toMatchObject({ ok: false, error: expect.stringMatching(/member of this organization/) });
        h.org = pendingOrg({ status: "approved", orgType: "ski_patrol" });
        expect(await reviewSarOrgAction(null, fd("reverify", "Called the area."))).toMatchObject({ ok: false });
      }
      expect(h.updates).toEqual([]);
      // Rejecting or suspending isn't vouching for the org, so it stays open to them.
      h.org = pendingOrg();
      expect(await reviewSarOrgAction(null, fd("reject", "No proof."))).toEqual({ ok: true });
    });
  });

  describe("AvServ sync and the program lifecycle (docs/plans/33)", () => {
    const at = (status: string, orgType = "sar_team") => pendingOrg({ status, orgType });

    it("syncs after approve, stamping a patrol's verification dates, and never after reject", async () => {
      h.org = at("pending", "ski_patrol");
      expect(await reviewSarOrgAction(null, fd("approve", "Spoke to J. Doe, patrol director, via the area's listed number."))).toEqual({ ok: true });
      expect(h.sync).toHaveBeenCalledWith(ORG_ID);
      const set = h.updates[0] as { verifiedAt: Date; reverifyBy: Date };
      expect(set.reverifyBy.getUTCFullYear() * 12 + set.reverifyBy.getUTCMonth() - (set.verifiedAt.getUTCFullYear() * 12 + set.verifiedAt.getUTCMonth())).toBe(12);
      h.sync.mockClear();
      h.org = at("pending");
      await reviewSarOrgAction(null, fd("reject", "No proof."));
      expect(h.sync).not.toHaveBeenCalled();
    });

    it("marks an approved org leaving and syncs it", async () => {
      h.org = at("approved");
      expect(await reviewSarOrgAction(null, fd("mark_leaving"))).toEqual({ ok: true });
      expect(h.updates[0]).toMatchObject({ status: "leaving", leavingNoticeAt: expect.any(Date) });
      expect(h.sync).toHaveBeenCalled();
    });

    it("withdraws only once every node reports 0 open bindings (sar_team_sync §2.5)", async () => {
      h.org = at("leaving");
      h.nodeViews = [{ openBindings: 0 }, { openBindings: 2 }];
      expect(await reviewSarOrgAction(null, fd("withdraw"))).toMatchObject({ ok: false, error: expect.stringMatching(/avserv-3 still has 2 check-outs/) });
      h.nodeViews = [{ openBindings: 0 }, new Error("timeout")];
      expect(await reviewSarOrgAction(null, fd("withdraw"))).toMatchObject({ ok: false, error: expect.stringMatching(/Couldn't confirm/) });
      // A node that hasn't received the team reports nothing, not 0.
      h.nodeViews = [{ openBindings: 0 }, null];
      expect(await reviewSarOrgAction(null, fd("withdraw"))).toMatchObject({ ok: false, error: expect.stringMatching(/avserv-3 hasn't received this team/) });
      // No nodes configured: nothing can confirm it.
      h.nodeViews = [];
      expect(await reviewSarOrgAction(null, fd("withdraw"))).toMatchObject({ ok: false, error: expect.stringMatching(/No AvAI servers/) });
      expect(h.updates).toEqual([]);
      h.nodeViews = [{ openBindings: 0 }, { openBindings: 0 }];
      expect(await reviewSarOrgAction(null, fd("withdraw"))).toEqual({ ok: true });
      expect(h.updates[0]).toEqual({ status: "withdrawn" });
    });

    it("re-verifies ski patrols only", async () => {
      h.org = at("approved");
      expect(await reviewSarOrgAction(null, fd("reverify"))).toMatchObject({ ok: false, error: "Only ski patrols are re-verified." });
      h.org = at("approved", "ski_patrol");
      expect(await reviewSarOrgAction(null, fd("reverify", "Called the area's front desk; patrol confirmed."))).toEqual({ ok: true });
      expect(h.updates[0]).toMatchObject({ verifiedAt: expect.any(Date), reverifyBy: expect.any(Date) });
    });

    it("requires a note recording the call before approving or re-verifying a patrol", async () => {
      h.org = at("pending", "ski_patrol");
      for (const note of [undefined, "   "]) {
        expect(await reviewSarOrgAction(null, fd("approve", note))).toMatchObject({
          ok: false,
          fieldErrors: { note: [expect.stringMatching(/call to the ski area/)] },
        });
      }
      h.org = at("approved", "ski_patrol");
      expect(await reviewSarOrgAction(null, fd("reverify"))).toMatchObject({ ok: false, fieldErrors: { note: expect.any(Array) } });
      expect(h.updates).toEqual([]);
      expect(h.sync).not.toHaveBeenCalled();
    });

    it("logs an approval note for staff and keeps it out of the submitter's email", async () => {
      h.org = at("pending");
      expect(await reviewSarOrgAction(null, fd("approve", "Checked the 501(c)(3) on the IRS lookup."))).toEqual({ ok: true });
      expect(h.logs[0]).toMatchObject({ action: "approved", note: "Checked the 501(c)(3) on the IRS lookup." });
      expect(sendSarOrgDecisionEmail).toHaveBeenCalledWith("sub@sar.org", expect.objectContaining({ note: undefined }));
      // An empty textarea logs no note rather than an empty one.
      h.logs = [];
      h.org = at("pending");
      await reviewSarOrgAction(null, fd("approve", ""));
      expect(h.logs[0]).toMatchObject({ note: null });
    });

    it("suspends a leaving org (for cause, immediate) and refuses lifecycle steps from the wrong status", async () => {
      h.org = at("leaving");
      expect(await reviewSarOrgAction(null, fd("suspend"))).toEqual({ ok: true });
      h.org = at("pending");
      expect(await reviewSarOrgAction(null, fd("mark_leaving"))).toMatchObject({ ok: false });
    });

    it("keeps the decision when the sync throws, and logs it", async () => {
      h.org = at("approved");
      h.sync.mockRejectedValueOnce(new Error("boom"));
      expect(await reviewSarOrgAction(null, fd("suspend"))).toEqual({ ok: true });
    });
  });
});

describe("resyncSarOrgAction", () => {
  const resync = (orgId = ORG_ID) => {
    const f = new FormData();
    f.set("orgId", orgId);
    return resyncSarOrgAction(f);
  };

  it("resends the org's current state to AvServ for staff", async () => {
    await expect(resync()).resolves.toBeUndefined();
    expect(h.sync).toHaveBeenCalledWith(ORG_ID);
  });

  it("refuses a signed-out caller and a non-staff one, without syncing", async () => {
    authMock.mockResolvedValue(null as never);
    await expect(resync()).rejects.toThrow();
    authMock.mockResolvedValue({ user: { id: "admin-1" } } as never);
    h.staff = false;
    await expect(resync()).rejects.toThrow(/access/);
    expect(h.sync).not.toHaveBeenCalled();
  });

  it("refuses a malformed org id", async () => {
    await expect(resync("not-a-uuid")).rejects.toThrow();
    expect(h.sync).not.toHaveBeenCalled();
  });
});
