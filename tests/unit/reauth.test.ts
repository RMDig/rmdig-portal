import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: null as null | Record<string, unknown>,
  google: [] as unknown[],
  rlAllowed: true,
  factorOk: true,
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/db/schema", () => ({
  users: { __t: "users" },
  accounts: { __t: "accounts" },
}));
vi.mock("drizzle-orm", () => ({ and: () => ({}), eq: () => ({}) }));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: (t: { __t: string }) => ({
        where: () => ({
          limit: () => Promise.resolve(t.__t === "users" ? (h.user ? [h.user] : []) : h.google),
        }),
      }),
    }),
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  incrementRateLimit: () => Promise.resolve({ allowed: h.rlAllowed, attempts: 1, resetAt: new Date() }),
}));
vi.mock("@/lib/auth/mfa", () => ({ decryptSecret: (s: string) => s }));
vi.mock("@/lib/auth/mfa-verify", () => ({ verifySecondFactor: () => Promise.resolve(h.factorOk) }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));

import { reauthOptions, verifyPasswordReauth } from "@/lib/auth/reauth";

let hash: string;
beforeEach(async () => {
  vi.clearAllMocks();
  hash ??= await bcrypt.hash("right-password", 4);
  h.user = { passwordHash: hash, mfaEnabledAt: null, totpSecretEncrypted: null };
  h.google = [];
  h.rlAllowed = true;
  h.factorOk = true;
});

describe("verifyPasswordReauth", () => {
  it("accepts the right password when two-factor is off", async () => {
    expect(await verifyPasswordReauth("u1", { password: "right-password", code: "" })).toBeNull();
  });

  it("refuses a wrong password", async () => {
    expect(await verifyPasswordReauth("u1", { password: "nope", code: "" })).toMatch(/incorrect/);
  });

  it("needs the code too when two-factor is on", async () => {
    h.user = { passwordHash: hash, mfaEnabledAt: new Date(), totpSecretEncrypted: "enc" };
    h.factorOk = false;
    expect(await verifyPasswordReauth("u1", { password: "right-password", code: "000000" })).toMatch(/code/);
    h.factorOk = true;
    expect(await verifyPasswordReauth("u1", { password: "right-password", code: "123456" })).toBeNull();
  });

  it("fails loud on two-factor enabled with no secret", async () => {
    h.user = { passwordHash: hash, mfaEnabledAt: new Date(), totpSecretEncrypted: null };
    expect(await verifyPasswordReauth("u1", { password: "right-password", code: "123456" })).toMatch(/misconfigured/);
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "auth.reauth.mfa_missing_secret" }));
  });

  it("is rate limited before the password is even checked", async () => {
    h.rlAllowed = false;
    expect(await verifyPasswordReauth("u1", { password: "right-password", code: "" })).toMatch(/Too many/);
  });

  it("points a Google-only account at Google", async () => {
    h.user = { passwordHash: null, mfaEnabledAt: null, totpSecretEncrypted: null };
    expect(await verifyPasswordReauth("u1", { password: "x", code: "" })).toMatch(/Google/);
  });
});

describe("reauthOptions", () => {
  it("reports password, two-factor and Google", async () => {
    h.user = { passwordHash: hash, mfaEnabledAt: new Date() };
    h.google = [{ provider: "google" }];
    expect(await reauthOptions("u1")).toEqual({ password: true, mfa: true, google: true });
    h.user = { passwordHash: null, mfaEnabledAt: null };
    h.google = [{ provider: "google" }];
    expect(await reauthOptions("u1")).toEqual({ password: false, mfa: false, google: true });
  });
});
