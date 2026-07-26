import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  selectResult: [] as Array<Record<string, unknown>>,
  rlAllowed: true,
  rlAttempts: 1,
  inserted: [] as Array<{ table: string; vals: Record<string, unknown> }>,
  deletes: [] as string[],
  updates: [] as Array<{ table: string; vals: Record<string, unknown> }>,
  sendReset: vi.fn(),
  sendVerify: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({ signIn: vi.fn(), signOut: vi.fn() }));
// actions.ts imports AuthError from next-auth at module load; stub it so the
// test doesn't pull in the full next-auth runtime (which needs next/server).
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));
vi.mock("@/lib/db/schema", () => ({
  users: { __t: "users", id: "id", email: "email", passwordHash: "passwordHash" },
  passwordResetTokens: { __t: "prt", userId: "userId", tokenHash: "tokenHash", expires: "expires" },
  sessions: { __t: "sessions", userId: "userId" },
  verificationTokens: { __t: "vt", identifier: "identifier", token: "token", expires: "expires" },
}));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(h.selectResult) }) }),
    }),
    insert: (table: { __t: string }) => ({
      values: (vals: Record<string, unknown>) => {
        h.inserted.push({ table: table.__t, vals });
        // Awaitable directly AND chainable with .returning() — covers both
        // `await db.insert().values()` and `await ....values().returning()`.
        return Object.assign(Promise.resolve(), {
          returning: () => Promise.resolve([{ id: "user-1" }]),
        });
      },
    }),
    delete: (table: { __t: string }) => ({
      where: () => {
        h.deletes.push(table.__t);
        return Promise.resolve();
      },
    }),
    update: (table: { __t: string }) => ({
      set: (vals: Record<string, unknown>) => ({
        where: () => {
          h.updates.push({ table: table.__t, vals });
          return Promise.resolve();
        },
      }),
    }),
  },
}));
vi.mock("@/lib/email/send", () => ({
  sendPasswordResetEmail: h.sendReset,
  sendVerificationEmail: h.sendVerify,
}));
vi.mock("@/lib/rate-limit", () => ({
  incrementRateLimit: () =>
    Promise.resolve({ allowed: h.rlAllowed, attempts: h.rlAttempts, resetAt: new Date() }),
}));
vi.mock("@/lib/logger", () => ({ logger: h.log }));

import {
  requestPasswordResetAction,
  resetPasswordAction,
  signUpAction,
} from "@/app/(auth)/actions";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.selectResult = [];
  h.rlAllowed = true;
  h.inserted = [];
  h.deletes = [];
  h.updates = [];
});

describe("requestPasswordResetAction", () => {
  it("rejects a malformed email with field errors", async () => {
    const res = await requestPasswordResetAction(null, form({ email: "not-an-email" }));
    expect(res.ok).toBe(false);
    expect(h.sendReset).not.toHaveBeenCalled();
  });

  it("returns neutral success and sends nothing when no user exists", async () => {
    h.selectResult = [];
    const res = await requestPasswordResetAction(null, form({ email: "ghost@rmdig.ai" }));
    expect(res).toEqual({ ok: true });
    expect(h.inserted).toHaveLength(0);
    expect(h.sendReset).not.toHaveBeenCalled();
  });

  it("returns neutral success for an OAuth-only user (no password to reset)", async () => {
    h.selectResult = [{ id: "u1", passwordHash: null }];
    const res = await requestPasswordResetAction(null, form({ email: "oauth@rmdig.ai" }));
    expect(res).toEqual({ ok: true });
    expect(h.inserted).toHaveLength(0);
    expect(h.sendReset).not.toHaveBeenCalled();
  });

  it("issues a token and emails a credentials user", async () => {
    h.selectResult = [{ id: "u1", passwordHash: "$2b$hash" }];
    const res = await requestPasswordResetAction(null, form({ email: "real@rmdig.ai" }));
    expect(res).toEqual({ ok: true });
    expect(h.inserted.some((i) => i.table === "prt")).toBe(true);
    expect(h.sendReset).toHaveBeenCalledTimes(1);
  });

  it("stays neutral and silent when rate-limited", async () => {
    h.rlAllowed = false;
    h.selectResult = [{ id: "u1", passwordHash: "$2b$hash" }];
    const res = await requestPasswordResetAction(null, form({ email: "real@rmdig.ai" }));
    expect(res).toEqual({ ok: true });
    expect(h.inserted).toHaveLength(0);
    expect(h.sendReset).not.toHaveBeenCalled();
  });
});

describe("resetPasswordAction", () => {
  it("rejects a too-short password with field errors", async () => {
    const res = await resetPasswordAction(
      null,
      form({ token: "t", password: "short", confirmPassword: "short" }),
    );
    expect(res.ok).toBe(false);
    expect(h.updates).toHaveLength(0);
  });

  it("rejects mismatched passwords with a confirmPassword field error", async () => {
    const res = await resetPasswordAction(
      null,
      form({ token: "t", password: "abcdefghijkl", confirmPassword: "abcdefghijkX" }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.fieldErrors?.confirmPassword).toBeTruthy();
    expect(h.updates).toHaveLength(0);
  });

  it("rejects an unknown or expired token", async () => {
    h.selectResult = [];
    const res = await resetPasswordAction(
      null,
      form({ token: "deadbeef", password: "abcdefghijkl", confirmPassword: "abcdefghijkl" }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/invalid or has expired/i);
    expect(h.updates).toHaveLength(0);
  });

  it("sets the new password, verifies email, and burns tokens + sessions", async () => {
    h.selectResult = [{ id: "t1", userId: "u1" }];
    const res = await resetPasswordAction(
      null,
      form({ token: "validtoken", password: "abcdefghijkl", confirmPassword: "abcdefghijkl" }),
    );
    expect(res).toEqual({ ok: true });

    const userUpdate = h.updates.find((u) => u.table === "users");
    expect(userUpdate?.vals.passwordHash).toBeTruthy();
    expect(userUpdate?.vals.emailVerified).toBeInstanceOf(Date);

    // Single-use + session invalidation.
    expect(h.deletes).toContain("prt");
    expect(h.deletes).toContain("sessions");
  });
});

describe("signUpAction", () => {
  it("rejects mismatched passwords with a confirmPassword field error", async () => {
    const res = await signUpAction(
      null,
      form({
        email: "new@rmdig.ai",
        password: "abcdefghijkl",
        confirmPassword: "abcdefghijkX",
      }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.fieldErrors?.confirmPassword).toBeTruthy();
    expect(h.inserted).toHaveLength(0);
    expect(h.sendVerify).not.toHaveBeenCalled();
  });

  it("creates the account and sends verification when passwords match", async () => {
    h.selectResult = []; // no existing user
    const res = await signUpAction(
      null,
      form({
        email: "new@rmdig.ai",
        password: "abcdefghijkl",
        confirmPassword: "abcdefghijkl",
      }),
    );
    expect(res).toEqual({ ok: true });
    expect(h.inserted.some((i) => i.table === "users")).toBe(true);
    expect(h.sendVerify).toHaveBeenCalledTimes(1);
    // No dropdown value (or a legacy form) defaults the routing hint.
    expect(h.inserted.find((i) => i.table === "users")?.vals.signupIntent).toBe("explorer");
  });

  it("stores the selected signup intent", async () => {
    h.selectResult = [];
    const res = await signUpAction(
      null,
      form({
        email: "sar-team@rmdig.ai",
        password: "abcdefghijkl",
        confirmPassword: "abcdefghijkl",
        intent: "sar",
      }),
    );
    expect(res).toEqual({ ok: true });
    expect(h.inserted.find((i) => i.table === "users")?.vals.signupIntent).toBe("sar");
  });

  it("rejects an unknown intent value", async () => {
    const res = await signUpAction(
      null,
      form({
        email: "new@rmdig.ai",
        password: "abcdefghijkl",
        confirmPassword: "abcdefghijkl",
        intent: "superuser",
      }),
    );
    expect(res.ok).toBe(false);
    expect(h.inserted).toHaveLength(0);
  });
});
