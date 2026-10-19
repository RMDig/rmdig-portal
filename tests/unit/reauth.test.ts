import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: null as null | Record<string, unknown>,
  rlAllowed: true,
  factorOk: true,
  passkeys: [] as unknown[],
  passkeyOk: true,
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/db/schema", () => ({
  users: { __t: "users" },
}));
vi.mock("drizzle-orm", () => ({ and: () => ({}), eq: () => ({}) }));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: (t: { __t: string }) => ({
        where: () => ({
          limit: () => Promise.resolve(t.__t === "users" && h.user ? [h.user] : []),
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
vi.mock("@/lib/auth/passkeys", () => ({
  listPasskeys: () => Promise.resolve(h.passkeys),
  verifyPasskeyAssertion: () => Promise.resolve(h.passkeyOk ? { ok: true, passkeyId: "pk-1" } : { ok: false }),
}));
vi.mock("@/lib/logger", () => ({ logger: h.log }));

import { reauthOptions, verifyPasswordReauth } from "@/lib/auth/reauth";

let hash: string;
beforeEach(async () => {
  vi.clearAllMocks();
  hash ??= await bcrypt.hash("right-password", 4);
  h.user = { passwordHash: hash, mfaEnabledAt: null, totpSecretEncrypted: null };
  h.rlAllowed = true;
  h.factorOk = true;
  h.passkeys = [];
  h.passkeyOk = true;
});

const ok = (method: string, passkeyId: string | null = null) => ({ ok: true, method, passkeyId });
const fails = (re: RegExp) => ({ ok: false, error: expect.stringMatching(re) });

describe("verifyPasswordReauth", () => {
  it("accepts the right password when two-factor is off", async () => {
    expect(await verifyPasswordReauth("u1", { password: "right-password", code: "" })).toEqual(ok("password"));
  });

  it("refuses a wrong password", async () => {
    expect(await verifyPasswordReauth("u1", { password: "nope", code: "" })).toEqual(fails(/incorrect/));
  });

  it("needs the code too when two-factor is on", async () => {
    h.user = { passwordHash: hash, mfaEnabledAt: new Date(), totpSecretEncrypted: "enc" };
    h.factorOk = false;
    expect(await verifyPasswordReauth("u1", { password: "right-password", code: "000000" })).toEqual(fails(/code/));
    h.factorOk = true;
    expect(await verifyPasswordReauth("u1", { password: "right-password", code: "123456" })).toEqual(ok("password"));
  });

  it("takes a passkey instead of the code, and says so (it decides a full revoke)", async () => {
    h.user = { passwordHash: hash, mfaEnabledAt: new Date(), totpSecretEncrypted: "enc" };
    expect(await verifyPasswordReauth("u1", { password: "right-password", code: "", passkey: "{}" })).toEqual(ok("passkey", "pk-1"));
    h.passkeyOk = false;
    expect(await verifyPasswordReauth("u1", { password: "right-password", code: "", passkey: "{}" })).toEqual(fails(/passkey/));
  });

  it("never accepts a passkey without the right password", async () => {
    h.user = { passwordHash: hash, mfaEnabledAt: new Date(), totpSecretEncrypted: "enc" };
    expect(await verifyPasswordReauth("u1", { password: "wrong", code: "", passkey: "{}" })).toEqual(fails(/incorrect/));
  });

  it("fails loud on two-factor enabled with no secret", async () => {
    h.user = { passwordHash: hash, mfaEnabledAt: new Date(), totpSecretEncrypted: null };
    expect(await verifyPasswordReauth("u1", { password: "right-password", code: "123456" })).toEqual(fails(/misconfigured/));
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "auth.reauth.mfa_missing_secret" }));
  });

  it("is rate limited before the password is even checked", async () => {
    h.rlAllowed = false;
    expect(await verifyPasswordReauth("u1", { password: "right-password", code: "" })).toEqual(fails(/Too many/));
  });

  it("tells a Google-only account to set a password first", async () => {
    h.user = { passwordHash: null, mfaEnabledAt: null, totpSecretEncrypted: null };
    expect(await verifyPasswordReauth("u1", { password: "x", code: "" })).toEqual(fails(/password yet/));
  });
});

describe("reauthOptions", () => {
  it("reports whether there's a password, two-factor and a passkey", async () => {
    h.user = { passwordHash: hash, mfaEnabledAt: new Date() };
    expect(await reauthOptions("u1")).toEqual({ password: true, mfa: true, passkey: false });
    h.passkeys = [{ id: "pk-1" }];
    expect(await reauthOptions("u1")).toEqual({ password: true, mfa: true, passkey: true });
    h.user = { passwordHash: null, mfaEnabledAt: null };
    expect(await reauthOptions("u1")).toEqual({ password: false, mfa: false, passkey: false });
  });
});
