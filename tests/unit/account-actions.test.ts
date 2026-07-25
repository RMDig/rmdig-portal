import { beforeEach, describe, expect, it, vi } from "vitest";

import bcrypt from "bcryptjs";

const h = vi.hoisted(() => ({
  sessionUserId: "u1" as string | undefined,
  selectResult: [] as Array<Record<string, unknown>>,
  rlAllowed: true,
  updates: [] as Array<Record<string, unknown>>,
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({
  auth: () => Promise.resolve(h.sessionUserId ? { user: { id: h.sessionUserId } } : null),
}));
vi.mock("@/lib/db/schema", () => ({
  users: { __t: "users", id: "id", displayName: "displayName", passwordHash: "passwordHash" },
}));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(h.selectResult) }) }),
    }),
    update: () => ({
      set: (vals: Record<string, unknown>) => ({
        where: () => {
          h.updates.push(vals);
          return Promise.resolve();
        },
      }),
    }),
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  incrementRateLimit: () => Promise.resolve({ allowed: h.rlAllowed, attempts: 1, resetAt: new Date() }),
}));
vi.mock("@/lib/logger", () => ({ logger: h.log }));

import {
  changePasswordAction,
  updateDisplayNameAction,
} from "@/app/(portal)/settings/account-actions";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.sessionUserId = "u1";
  h.selectResult = [];
  h.rlAllowed = true;
  h.updates = [];
});

describe("updateDisplayNameAction", () => {
  it("rejects an empty name", async () => {
    const res = await updateDisplayNameAction(null, form({ displayName: "  " }));
    expect(res.ok).toBe(false);
    expect(h.updates).toHaveLength(0);
  });

  it("trims and persists a valid name", async () => {
    const res = await updateDisplayNameAction(null, form({ displayName: "  Denny  " }));
    expect(res).toEqual({ ok: true });
    expect(h.updates[0]?.displayName).toBe("Denny");
  });

  it("refuses when signed out", async () => {
    h.sessionUserId = undefined;
    const res = await updateDisplayNameAction(null, form({ displayName: "Denny" }));
    expect(res.ok).toBe(false);
    expect(h.updates).toHaveLength(0);
  });
});

describe("changePasswordAction", () => {
  it("rejects a too-short new password", async () => {
    const res = await changePasswordAction(
      null,
      form({ currentPassword: "whatever", newPassword: "short", confirmPassword: "short" }),
    );
    expect(res.ok).toBe(false);
    expect(h.updates).toHaveLength(0);
  });

  it("rejects mismatched passwords with a confirmPassword field error", async () => {
    const res = await changePasswordAction(
      null,
      form({ currentPassword: "whatever", newPassword: "abcdefghijkl", confirmPassword: "abcdefghijkX" }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.fieldErrors?.confirmPassword).toBeTruthy();
    expect(h.updates).toHaveLength(0);
  });

  it("refuses an OAuth-only account (no password to change)", async () => {
    h.selectResult = [{ passwordHash: null }];
    const res = await changePasswordAction(
      null,
      form({ currentPassword: "whatever", newPassword: "abcdefghijkl", confirmPassword: "abcdefghijkl" }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Google/);
    expect(h.updates).toHaveLength(0);
  });

  it("rejects an incorrect current password", async () => {
    h.selectResult = [{ passwordHash: await bcrypt.hash("realpassword", 4) }];
    const res = await changePasswordAction(
      null,
      form({ currentPassword: "wrongpassword", newPassword: "abcdefghijkl", confirmPassword: "abcdefghijkl" }),
    );
    expect(res.ok).toBe(false);
    expect(h.updates).toHaveLength(0);
  });

  it("updates the hash when the current password checks out", async () => {
    h.selectResult = [{ passwordHash: await bcrypt.hash("realpassword", 4) }];
    const res = await changePasswordAction(
      null,
      form({ currentPassword: "realpassword", newPassword: "abcdefghijkl", confirmPassword: "abcdefghijkl" }),
    );
    expect(res).toEqual({ ok: true });
    expect(h.updates[0]?.passwordHash).toBeTruthy();
    expect(h.updates[0]?.passwordHash).not.toBe("realpassword");
  });

  it("stays neutral-safe when rate-limited", async () => {
    h.rlAllowed = false;
    h.selectResult = [{ passwordHash: await bcrypt.hash("realpassword", 4) }];
    const res = await changePasswordAction(
      null,
      form({ currentPassword: "realpassword", newPassword: "abcdefghijkl", confirmPassword: "abcdefghijkl" }),
    );
    expect(res.ok).toBe(false);
    expect(h.updates).toHaveLength(0);
  });
});
