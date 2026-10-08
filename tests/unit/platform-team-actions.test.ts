import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Harness for the staff-management actions. db.select() calls are served from
// a FIFO queue (the actions issue several differently-shaped selects in
// sequence); inserts/deletes/updates are recorded flat, including those made
// inside db.transaction (the tx object is the same mock).
const h = vi.hoisted(() => ({
  session: { user: { id: "admin-1", email: "boss@rmdig.ai" } } as {
    user: { id: string; email: string };
  } | null,
  isAdmin: true,
  selectQueue: [] as unknown[][],
  inserted: [] as Array<{ table: string; vals: Record<string, unknown> }>,
  deleted: [] as Array<{ table: string; result: unknown[] }>,
  deleteResult: [] as unknown[],
  updateResult: [] as unknown[],
  rlAllowed: true,
  sendInvite: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function chain() {
  const rows = h.selectQueue.shift() ?? [];
  const c: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where", "orderBy"]) {
    c[m] = () => c;
  }
  c.limit = () => Promise.resolve(rows);
  c.then = (res: (v: unknown[]) => unknown) => Promise.resolve(rows).then(res);
  return c;
}

const dbMock = {
  select: () => chain(),
  insert: (table: { __t: string }) => ({
    values: (vals: Record<string, unknown>) => {
      h.inserted.push({ table: table.__t, vals });
      return Object.assign(Promise.resolve(), {
        onConflictDoNothing: () => Promise.resolve(),
        returning: () => Promise.resolve([{ id: "row-1" }]),
      });
    },
  }),
  delete: (table: { __t: string }) => ({
    where: () => ({
      returning: () => {
        h.deleted.push({ table: table.__t, result: h.deleteResult });
        return Promise.resolve(h.deleteResult);
      },
    }),
  }),
  update: () => ({
    set: () => ({ where: () => ({ returning: () => Promise.resolve(h.updateResult) }) }),
  }),
  // `unknown` breaks the self-referential type cycle; the actions type tx via
  // drizzle's own signature and the mock just hands itself back.
  transaction: async (cb: (tx: never) => Promise<unknown>) => cb(dbMock as never),
};

vi.mock("@/lib/auth", () => ({ auth: () => Promise.resolve(h.session) }));
vi.mock("@/lib/auth/mfa-gate", () => ({ userMfaGate: () => Promise.resolve({ gate: "ok", roles: [] }) }));
vi.mock("@/lib/auth/roles", () => ({
  hasPlatformRole: () => Promise.resolve(h.isAdmin),
  PLATFORM_ROLE_LABEL: { rmdig_admin: "Platform Administrator", rmdig_reviewer: "Reviewer", rmdig_sar_approver: "SAR Approver" },
}));
vi.mock("@/lib/db", () => ({
  get db() {
    return dbMock;
  },
}));
vi.mock("@/lib/db/schema", () => ({
  platformRoleInvitations: { __t: "invites", id: "id" },
  platformRoleLog: { __t: "log" },
  userPlatformRoles: { __t: "roles", userId: "userId", role: "role" },
  users: { __t: "users", id: "id", email: "email" },
}));
vi.mock("@/lib/email/send", () => ({ sendPlatformInviteEmail: h.sendInvite }));
vi.mock("@/lib/rate-limit", () => ({
  incrementRateLimit: () =>
    Promise.resolve({ allowed: h.rlAllowed, attempts: 1, resetAt: new Date() }),
}));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  cancelPlatformInviteAction,
  createPlatformInviteAction,
  revokePlatformRoleAction,
} from "@/app/(portal)/admin/team/actions";
import { acceptPlatformInviteAction } from "@/app/admin-invite/[token]/actions";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const HASH = await bcrypt.hash("correct-password", 4);

beforeEach(() => {
  vi.clearAllMocks();
  h.session = { user: { id: "admin-1", email: "boss@rmdig.ai" } };
  h.isAdmin = true;
  h.selectQueue = [];
  h.inserted = [];
  h.deleted = [];
  h.deleteResult = [];
  h.updateResult = [];
  h.rlAllowed = true;
});

describe("createPlatformInviteAction", () => {
  const goodForm = () =>
    form({ email: "new@rmdig.ai", role: "rmdig_reviewer", currentPassword: "correct-password" });

  it("rejects a non-admin", async () => {
    h.isAdmin = false;
    const res = await createPlatformInviteAction(null, goodForm());
    expect(res?.ok).toBe(false);
    expect(h.inserted).toHaveLength(0);
  });

  it("rejects a wrong password loudly, without writing or emailing", async () => {
    h.selectQueue = [[{ passwordHash: HASH }]];
    const res = await createPlatformInviteAction(
      null,
      form({ email: "new@rmdig.ai", role: "rmdig_reviewer", currentPassword: "wrong" }),
    );
    expect(res?.ok).toBe(false);
    if (res && !res.ok) expect(res.error).toMatch(/incorrect password/i);
    expect(h.inserted).toHaveLength(0);
    expect(h.sendInvite).not.toHaveBeenCalled();
  });

  it("stops at the re-auth rate limit", async () => {
    h.rlAllowed = false;
    const res = await createPlatformInviteAction(null, goodForm());
    expect(res?.ok).toBe(false);
    if (res && !res.ok) expect(res.error).toMatch(/too many/i);
    expect(h.inserted).toHaveLength(0);
  });

  it("fails loud for an OAuth-only (passwordless) admin", async () => {
    h.selectQueue = [[{ passwordHash: null }]];
    const res = await createPlatformInviteAction(null, goodForm());
    expect(res?.ok).toBe(false);
    if (res && !res.ok) expect(res.error).toMatch(/set a password/i);
  });

  it("refuses when the target already holds the role", async () => {
    h.selectQueue = [[{ passwordHash: HASH }], [{ userId: "u-2" }]];
    const res = await createPlatformInviteAction(null, goodForm());
    expect(res?.ok).toBe(false);
    if (res && !res.ok) expect(res.error).toMatch(/already holds/i);
  });

  it("creates the invite, logs it, and emails an /admin-invite link", async () => {
    h.selectQueue = [[{ passwordHash: HASH }], [], []];
    const res = await createPlatformInviteAction(null, goodForm());
    expect(res).toEqual({ ok: true });
    expect(h.inserted.some((i) => i.table === "invites")).toBe(true);
    expect(h.inserted.some((i) => i.table === "log")).toBe(true);
    // Hashed at rest; plaintext only in the emailed link.
    const invite = h.inserted.find((i) => i.table === "invites")!;
    expect(invite.vals.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    const [, params] = h.sendInvite.mock.calls[0] as [string, { inviteUrl: string }];
    expect(params.inviteUrl).toContain("/admin-invite/");
    expect(params.inviteUrl).not.toContain(String(invite.vals.tokenHash));
  });

  it("lets only an admin invite a SAR approver, and names the role in the email", async () => {
    const approverForm = () => form({ email: "sar@rmdig.ai", role: "rmdig_sar_approver", currentPassword: "correct-password" });
    h.isAdmin = false;
    expect(await createPlatformInviteAction(null, approverForm())).toMatchObject({ ok: false, error: expect.stringMatching(/administrator/) });
    expect(h.inserted).toHaveLength(0);
    h.isAdmin = true;
    h.selectQueue = [[{ passwordHash: HASH }], [], []];
    expect(await createPlatformInviteAction(null, approverForm())).toEqual({ ok: true });
    expect(h.inserted.find((i) => i.table === "invites")?.vals.role).toBe("rmdig_sar_approver");
    expect(h.sendInvite).toHaveBeenCalledWith("sar@rmdig.ai", expect.objectContaining({ roleLabel: "SAR Approver" }));
  });

  it("surfaces an email failure instead of pretending success", async () => {
    h.selectQueue = [[{ passwordHash: HASH }], [], []];
    h.sendInvite.mockRejectedValueOnce(new Error("resend down"));
    const res = await createPlatformInviteAction(null, goodForm());
    expect(res?.ok).toBe(false);
    expect(h.log.error).toHaveBeenCalled();
  });
});

describe("cancelPlatformInviteAction", () => {
  const INVITE = "33333333-3333-4333-8333-333333333333";

  it("deletes the invitation and logs who cancelled it", async () => {
    h.deleteResult = [{ email: "new@rmdig.ai", role: "rmdig_reviewer" }];
    expect(await cancelPlatformInviteAction({ ok: true }, form({ inviteId: INVITE }))).toEqual({ ok: true });
    expect(h.deleted).toEqual([{ table: "invites", result: h.deleteResult }]);
    expect(h.inserted).toContainEqual({
      table: "log",
      vals: { action: "invite_cancelled", role: "rmdig_reviewer", targetEmail: "new@rmdig.ai", actorUserId: "admin-1" },
    });
  });

  it("refuses a non-admin and a signed-out caller, deleting nothing", async () => {
    h.isAdmin = false;
    expect(await cancelPlatformInviteAction({ ok: true }, form({ inviteId: INVITE }))).toMatchObject({ ok: false, error: expect.stringMatching(/administrator/) });
    h.session = null;
    expect(await cancelPlatformInviteAction({ ok: true }, form({ inviteId: INVITE }))).toMatchObject({ ok: false });
    expect(h.deleted).toEqual([]);
    expect(h.inserted).toEqual([]);
  });

  it("rejects a malformed id, and says when the invitation is already gone", async () => {
    expect(await cancelPlatformInviteAction({ ok: true }, form({ inviteId: "nope" }))).toEqual({ ok: false, error: "Invalid invitation." });
    expect(h.deleted).toEqual([]);
    h.deleteResult = [];
    expect(await cancelPlatformInviteAction({ ok: true }, form({ inviteId: INVITE }))).toEqual({ ok: false, error: "That invitation no longer exists." });
    expect(h.inserted).toEqual([]);
  });
});

describe("revokePlatformRoleAction", () => {
  const goodForm = (role = "rmdig_reviewer") =>
    form({
      targetUserId: "3f0e8a10-0000-4000-8000-000000000002",
      role,
      currentPassword: "correct-password",
    });

  it("blocks revoking the last platform administrator", async () => {
    h.selectQueue = [[{ passwordHash: HASH }], [{ userId: "admin-1" }]];
    const res = await revokePlatformRoleAction(null, goodForm("rmdig_admin"));
    expect(res?.ok).toBe(false);
    if (res && !res.ok) expect(res.error).toMatch(/last platform administrator/i);
    expect(h.deleted).toHaveLength(0);
  });

  it("revokes and logs when another admin remains", async () => {
    h.selectQueue = [
      [{ passwordHash: HASH }],
      [{ userId: "admin-1" }, { userId: "admin-2" }],
      [{ email: "old@rmdig.ai" }],
    ];
    h.deleteResult = [{ userId: "u-2" }];
    const res = await revokePlatformRoleAction(null, goodForm("rmdig_admin"));
    expect(res).toEqual({ ok: true });
    expect(h.deleted.some((d) => d.table === "roles")).toBe(true);
    expect(h.inserted.find((i) => i.table === "log")?.vals.action).toBe("revoked");
  });

  it("blocks revoking the last SAR approver, and revokes one when another remains", async () => {
    h.selectQueue = [[{ passwordHash: HASH }], [{ userId: "admin-1" }]];
    expect(await revokePlatformRoleAction(null, goodForm("rmdig_sar_approver"))).toMatchObject({ ok: false, error: expect.stringMatching(/last SAR approver/) });
    expect(h.deleted).toHaveLength(0);
    h.selectQueue = [[{ passwordHash: HASH }], [{ userId: "admin-1" }, { userId: "a-2" }], [{ email: "old@rmdig.ai" }]];
    h.deleteResult = [{ userId: "a-2" }];
    expect(await revokePlatformRoleAction(null, goodForm("rmdig_sar_approver"))).toEqual({ ok: true });
    expect(h.inserted.find((i) => i.table === "log")?.vals).toMatchObject({ action: "revoked", role: "rmdig_sar_approver" });
  });

  it("lets only an admin revoke a SAR approver", async () => {
    h.isAdmin = false;
    expect(await revokePlatformRoleAction(null, goodForm("rmdig_sar_approver"))).toMatchObject({ ok: false });
    expect(h.deleted).toHaveLength(0);
  });

  it("reports when the target doesn't hold the role", async () => {
    h.selectQueue = [[{ passwordHash: HASH }], [{ email: "x@rmdig.ai" }]];
    h.deleteResult = [];
    const res = await revokePlatformRoleAction(null, goodForm());
    expect(res?.ok).toBe(false);
    if (res && !res.ok) expect(res.error).toMatch(/doesn't hold/i);
  });
});

describe("acceptPlatformInviteAction", () => {
  const invite = {
    id: "inv-1",
    email: "boss@rmdig.ai",
    role: "rmdig_reviewer",
    createdByUserId: "admin-0",
  };

  it("requires a session", async () => {
    h.session = null;
    const res = await acceptPlatformInviteAction("tok", null, form({}));
    expect(res?.ok).toBe(false);
  });

  it("rejects a session email that doesn't match the invitation", async () => {
    h.session = { user: { id: "u-9", email: "someone-else@rmdig.ai" } };
    h.selectQueue = [[invite]];
    const res = await acceptPlatformInviteAction("tok", null, form({}));
    expect(res?.ok).toBe(false);
    if (res && !res.ok) expect(res.error).toMatch(/issued to boss@rmdig.ai/i);
    expect(h.inserted).toHaveLength(0);
  });

  it("grants the role, claims the invite once, and logs the grant", async () => {
    h.selectQueue = [[invite]];
    h.updateResult = [{ id: "inv-1" }];
    const res = await acceptPlatformInviteAction("tok", null, form({}));
    expect(res).toEqual({ ok: true });
    expect(h.inserted.find((i) => i.table === "roles")?.vals).toMatchObject({
      userId: "admin-1",
      role: "rmdig_reviewer",
    });
    expect(h.inserted.find((i) => i.table === "log")?.vals.action).toBe("granted");
  });

  it("fails loud when the invite was already claimed (race)", async () => {
    h.selectQueue = [[invite]];
    h.updateResult = [];
    const res = await acceptPlatformInviteAction("tok", null, form({}));
    expect(res?.ok).toBe(false);
    expect(h.log.error).toHaveBeenCalled();
  });
});
