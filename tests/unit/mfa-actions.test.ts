import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sessionUserId: "u1" as string | undefined,
  selectResult: [] as Array<Record<string, unknown>>,
  totpValid: true,
  secondFactorValid: true,
  updates: [] as Array<Record<string, unknown>>,
  deletes: [] as string[],
  inserts: [] as unknown[],
  rlAllowed: true,
  rlKeys: [] as string[],
  secondFactorCalls: 0,
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({
  auth: () => Promise.resolve(h.sessionUserId ? { user: { id: h.sessionUserId } } : null),
}));
vi.mock("@/lib/db/schema", () => ({
  users: { __t: "users", id: "id", totpSecretEncrypted: "s", mfaEnabledAt: "e" },
  mfaRecoveryCodes: { __t: "rc", userId: "user_id", codeHash: "code_hash" },
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
    delete: (table: { __t: string }) => ({
      where: () => {
        h.deletes.push(table.__t);
        return Promise.resolve();
      },
    }),
    insert: () => ({
      values: (vals: unknown) => {
        h.inserts.push(vals);
        return Promise.resolve();
      },
    }),
  },
}));
vi.mock("@/lib/auth/mfa", () => ({
  decryptSecret: (s: string) => s,
  verifyTotp: () => Promise.resolve(h.totpValid),
  generateRecoveryCodes: () => ["AAAA-1111", "BBBB-2222"],
  hashRecoveryCode: (c: string) => `hash(${c})`,
}));
vi.mock("@/lib/auth/mfa-verify", () => ({
  verifySecondFactor: () => {
    h.secondFactorCalls++;
    return Promise.resolve(h.secondFactorValid);
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  incrementRateLimit: (key: string) => {
    h.rlKeys.push(key);
    return Promise.resolve({ allowed: h.rlAllowed, attempts: 6, resetAt: new Date() });
  },
}));
vi.mock("@/lib/logger", () => ({ logger: h.log }));

import {
  confirmMfaEnrollmentAction,
  disableMfaAction,
  regenerateRecoveryCodesAction,
} from "@/app/(portal)/settings/mfa/actions";

function form(code: string): FormData {
  const fd = new FormData();
  fd.set("code", code);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.sessionUserId = "u1";
  h.selectResult = [];
  h.totpValid = true;
  h.secondFactorValid = true;
  h.updates = [];
  h.deletes = [];
  h.inserts = [];
  h.rlAllowed = true;
  h.rlKeys = [];
  h.secondFactorCalls = 0;
});

describe("confirmMfaEnrollmentAction", () => {
  it("refuses when signed out", async () => {
    h.sessionUserId = undefined;
    const res = await confirmMfaEnrollmentAction(null, form("123456"));
    expect(res.ok).toBe(false);
  });

  it("refuses when there is no pending secret", async () => {
    h.selectResult = [{ secret: null, enabledAt: null }];
    const res = await confirmMfaEnrollmentAction(null, form("123456"));
    expect(res.ok).toBe(false);
    expect(h.updates).toHaveLength(0);
  });

  it("refuses when MFA is already enabled", async () => {
    h.selectResult = [{ secret: "enc", enabledAt: new Date() }];
    const res = await confirmMfaEnrollmentAction(null, form("123456"));
    expect(res.ok).toBe(false);
  });

  it("rejects a wrong code", async () => {
    h.selectResult = [{ secret: "enc", enabledAt: null }];
    h.totpValid = false;
    const res = await confirmMfaEnrollmentAction(null, form("000000"));
    expect(res.ok).toBe(false);
    expect(h.updates).toHaveLength(0);
  });

  it("enables MFA and returns recovery codes on a valid code", async () => {
    h.selectResult = [{ secret: "enc", enabledAt: null }];
    const res = await confirmMfaEnrollmentAction(null, form("123456"));
    expect(res.ok).toBe(true);
    if (res.ok && "recoveryCodes" in res) {
      expect(res.recoveryCodes).toHaveLength(2);
    } else {
      throw new Error("expected recovery codes");
    }
    expect(h.updates[0]?.mfaEnabledAt).toBeInstanceOf(Date);
    expect(h.deletes).toContain("rc"); // cleared prior codes
    expect(h.inserts).toHaveLength(1); // inserted new set
  });
});

describe("disableMfaAction", () => {
  it("refuses when MFA isn't enabled", async () => {
    h.selectResult = [{ secret: null, enabledAt: null }];
    const res = await disableMfaAction(null, form("123456"));
    expect(res.ok).toBe(false);
  });

  it("rejects an invalid second factor", async () => {
    h.selectResult = [{ secret: "enc", enabledAt: new Date() }];
    h.secondFactorValid = false;
    const res = await disableMfaAction(null, form("000000"));
    expect(res.ok).toBe(false);
    expect(h.updates).toHaveLength(0);
  });

  it("clears the secret and codes on a valid factor", async () => {
    h.selectResult = [{ secret: "enc", enabledAt: new Date() }];
    const res = await disableMfaAction(null, form("123456"));
    expect(res.ok).toBe(true);
    expect(h.updates[0]).toMatchObject({ totpSecretEncrypted: null, mfaEnabledAt: null });
    expect(h.deletes).toContain("rc");
  });
});

describe("regenerateRecoveryCodesAction", () => {
  it("rejects an invalid second factor", async () => {
    h.selectResult = [{ secret: "enc", enabledAt: new Date() }];
    h.secondFactorValid = false;
    const res = await regenerateRecoveryCodesAction(null, form("000000"));
    expect(res.ok).toBe(false);
    expect(h.inserts).toHaveLength(0);
  });

  it("issues a fresh set on a valid factor", async () => {
    h.selectResult = [{ secret: "enc", enabledAt: new Date() }];
    const res = await regenerateRecoveryCodesAction(null, form("123456"));
    expect(res.ok).toBe(true);
    if (res.ok && "recoveryCodes" in res) {
      expect(res.recoveryCodes).toHaveLength(2);
    } else {
      throw new Error("expected recovery codes");
    }
    expect(h.deletes).toContain("rc");
    expect(h.inserts).toHaveLength(1);
  });
});

describe("second-factor attempt limit on disable / regenerate", () => {
  const enabled = () => {
    h.selectResult = [{ secret: "enc", enabledAt: new Date() }];
  };

  it("counts both actions against one per-user bucket", async () => {
    enabled();
    await disableMfaAction(null, form("123456"));
    await regenerateRecoveryCodesAction(null, form("123456"));
    expect(h.rlKeys).toEqual(["mfa-manage:u1", "mfa-manage:u1"]);
  });

  it("refuses disable over the limit without checking the code or changing anything", async () => {
    enabled();
    h.rlAllowed = false;
    const res = await disableMfaAction(null, form("123456"));
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/Too many attempts/) });
    expect(h.secondFactorCalls).toBe(0);
    expect(h.updates).toEqual([]);
    expect(h.deletes).toEqual([]);
    expect(h.log.warn).toHaveBeenCalledWith(expect.objectContaining({ event: "mfa.manage_rate_limited", action: "disable" }));
  });

  it("refuses regenerate over the limit without issuing codes", async () => {
    enabled();
    h.rlAllowed = false;
    const res = await regenerateRecoveryCodesAction(null, form("123456"));
    expect(res.ok).toBe(false);
    expect(h.secondFactorCalls).toBe(0);
    expect(h.inserts).toEqual([]);
  });

  it("doesn't spend an attempt when MFA isn't enabled or the caller is signed out", async () => {
    h.selectResult = [{ secret: null, enabledAt: null }];
    await disableMfaAction(null, form("123456"));
    h.sessionUserId = undefined;
    await regenerateRecoveryCodesAction(null, form("123456"));
    expect(h.rlKeys).toEqual([]);
  });
});
