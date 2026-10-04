import { beforeEach, describe, expect, it, vi } from "vitest";

// Members actions: org-admin only; membership rows locked; the rules applied;
// a log row in the same transaction; failures loud.

const h = vi.hoisted(() => ({
  userId: "11111111-1111-4111-8111-111111111111" as string | undefined,
  canManage: true,
  members: [] as Array<{ userId: string; role: string; email: string }>,
  locked: false,
  updates: [] as unknown[],
  deletes: 0,
  deleteReturns: [] as unknown[],
  logs: [] as unknown[],
  txError: null as unknown,
  revalidate: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/db", () => {
  const tx = {
    select: () => {
      const chain: Record<string, unknown> = {};
      for (const m of ["from", "innerJoin", "where"]) chain[m] = () => chain;
      chain.for = () => {
        h.locked = true;
        return Promise.resolve(h.members);
      };
      return chain;
    },
    update: () => ({ set: (v: unknown) => ({ where: () => { h.updates.push(v); return Promise.resolve(); } }) }),
    delete: () => ({
      where: () => {
        h.deletes++;
        return Object.assign(Promise.resolve(), { returning: () => Promise.resolve(h.deleteReturns) });
      },
    }),
    insert: () => ({ values: (v: unknown) => { h.logs.push(v); return Promise.resolve(); } }),
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
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidate }));

import {
  changeMemberRoleAction,
  removeMemberAction,
  revokeInvitationAction,
} from "@/app/(portal)/sar/[orgId]/members/manage-actions";

const ORG = "99999999-9999-4999-8999-999999999999";
const ME = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const INV = "55555555-5555-4555-8555-555555555555";
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  h.userId = ME;
  h.canManage = true;
  h.members = [
    { userId: ME, role: "admin", email: "me@sar.org" },
    { userId: B, role: "responder", email: "b@sar.org" },
  ];
  h.locked = false;
  h.updates = [];
  h.deletes = 0;
  h.deleteReturns = [];
  h.logs = [];
  h.txError = null;
});

describe("changeMemberRoleAction", () => {
  it("locks the rows, changes the role and logs it", async () => {
    const res = await changeMemberRoleAction(ORG, null, fd({ userId: B, role: "dispatcher" }));
    expect(res).toEqual({ ok: true, message: "Updated b@sar.org's role." });
    expect(h.locked).toBe(true);
    expect(h.updates).toEqual([{ role: "dispatcher" }]);
    expect(h.logs[0]).toMatchObject({ orgId: ORG, action: "role_changed", subjectUserId: B, subjectEmail: "b@sar.org", fromRole: "responder", toRole: "dispatcher", actorUserId: ME });
    expect(h.revalidate).toHaveBeenCalledWith(`/sar/${ORG}/members`);
  });

  it("refuses to demote the last admin and writes nothing", async () => {
    const res = await changeMemberRoleAction(ORG, null, fd({ userId: ME, role: "responder" }));
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/at least one admin/) });
    expect(h.updates).toEqual([]);
    expect(h.logs).toEqual([]);
  });

  it("refuses non-admins and signed-out users before touching the database", async () => {
    h.canManage = false;
    expect(await changeMemberRoleAction(ORG, null, fd({ userId: B, role: "admin" }))).toMatchObject({ ok: false });
    h.userId = undefined;
    expect(await changeMemberRoleAction(ORG, null, fd({ userId: B, role: "admin" }))).toMatchObject({ ok: false });
    expect(h.locked).toBe(false);
  });

  it("rejects a bad role and fails loud on a database error", async () => {
    expect(await changeMemberRoleAction(ORG, null, fd({ userId: B, role: "owner" }))).toMatchObject({ ok: false });
    h.txError = new Error("deadlock");
    expect(await changeMemberRoleAction(ORG, null, fd({ userId: B, role: "dispatcher" }))).toMatchObject({ ok: false, error: expect.stringMatching(/Couldn't save/) });
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "sar.members.change_failed" }));
  });
});

describe("removeMemberAction", () => {
  it("removes another member and logs `removed`", async () => {
    expect(await removeMemberAction(ORG, null, fd({ userId: B }))).toEqual({ ok: true, message: "Removed b@sar.org." });
    expect(h.deletes).toBe(1);
    expect(h.logs[0]).toMatchObject({ action: "removed", fromRole: "responder", toRole: null });
  });

  it("won't let the last admin leave", async () => {
    expect(await removeMemberAction(ORG, null, fd({ userId: ME }))).toMatchObject({ ok: false });
    expect(h.deletes).toBe(0);
  });

  it("logs `left` when an admin leaves and another admin remains", async () => {
    h.members.push({ userId: "66666666-6666-4666-8666-666666666666", role: "admin", email: "c@sar.org" });
    expect(await removeMemberAction(ORG, null, fd({ userId: ME }))).toEqual({ ok: true, message: "You left the organization." });
    expect(h.logs[0]).toMatchObject({ action: "left", subjectUserId: ME });
  });
});

describe("revokeInvitationAction", () => {
  it("revokes a pending invitation and logs it", async () => {
    h.deleteReturns = [{ email: "new@sar.org", role: "responder" }];
    expect(await revokeInvitationAction(ORG, null, fd({ invitationId: INV }))).toEqual({ ok: true, message: "Revoked the invitation to new@sar.org." });
    expect(h.logs[0]).toMatchObject({ orgId: ORG, action: "invite_revoked", subjectEmail: "new@sar.org", toRole: "responder", actorUserId: ME });
  });

  it("reports an invitation that was already used or revoked", async () => {
    h.deleteReturns = [];
    expect(await revokeInvitationAction(ORG, null, fd({ invitationId: INV }))).toMatchObject({ ok: false, error: expect.stringMatching(/already used or revoked/) });
    expect(h.logs).toEqual([]);
  });

  it("refuses non-admins", async () => {
    h.canManage = false;
    expect(await revokeInvitationAction(ORG, null, fd({ invitationId: INV }))).toMatchObject({ ok: false });
    expect(h.deletes).toBe(0);
  });
});
