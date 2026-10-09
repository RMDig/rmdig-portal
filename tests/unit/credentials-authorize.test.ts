import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Credentials sign-in throttling: a per-IP bucket, a tight per-(address, IP)
// bucket, and an address-wide cap that only failures count toward — so a
// stranger's failed guesses can't lock the owner out from the owner's network.

const h = vi.hoisted(() => ({
  ip: "198.51.100.1",
  user: null as Record<string, unknown> | null,
  blocked: new Set<string>(),
  failurePeekBlocked: false,
  increments: [] as string[],
  peeks: [] as string[],
  resets: [] as string[],
  dbReads: 0,
  secondFactorOk: false,
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("next-auth", () => ({ CredentialsSignin: class CredentialsSignin extends Error {} }));
vi.mock("drizzle-orm", () => ({ eq: () => ({}) }));
vi.mock("@/lib/db/schema", () => ({ users: {} }));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => {
            h.dbReads++;
            return Promise.resolve(h.user ? [h.user] : []);
          },
        }),
      }),
    }),
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  incrementRateLimit: (key: string) => {
    h.increments.push(key);
    const prefix = key.split(":")[0]!;
    return Promise.resolve({ allowed: !h.blocked.has(prefix), attempts: 1, resetAt: new Date() });
  },
  peekRateLimit: (key: string) => {
    h.peeks.push(key);
    return Promise.resolve({ allowed: !h.failurePeekBlocked, attempts: 0, resetAt: new Date() });
  },
  resetRateLimit: (key: string) => {
    h.resets.push(key);
    return Promise.resolve();
  },
}));
vi.mock("@/lib/client-ip", () => ({ clientIp: () => Promise.resolve(h.ip) }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("@/lib/auth/mfa", () => ({ decryptSecret: (s: string) => s }));
vi.mock("@/lib/auth/mfa-verify", () => ({ verifySecondFactor: () => Promise.resolve(h.secondFactorOk) }));

import {
  EmailUnverifiedError,
  MfaInvalidError,
  MfaRequiredError,
  SIGNIN_EMAIL_FAILURE_LIMIT,
  SIGNIN_IP_RATE_LIMIT,
  SIGNIN_SOURCE_RATE_LIMIT,
  SignInRateLimitedError,
  authorizeCredentials,
} from "@/lib/auth/credentials-authorize";

const EMAIL = "pat@example.org";
const PASSWORD = "correct horse battery";
let HASH = "";

async function verifiedUser(extra: Record<string, unknown> = {}) {
  HASH ||= await bcrypt.hash(PASSWORD, 4);
  h.user = {
    id: "u1",
    email: EMAIL,
    name: "Pat",
    displayName: null,
    image: null,
    passwordHash: HASH,
    emailVerified: new Date(),
    mfaEnabledAt: null,
    totpSecretEncrypted: null,
    ...extra,
  };
}

const failureKey = `signin-fail:${EMAIL}`;

beforeEach(() => {
  vi.clearAllMocks();
  h.ip = "198.51.100.1";
  h.user = null;
  h.blocked = new Set();
  h.failurePeekBlocked = false;
  h.increments = [];
  h.peeks = [];
  h.resets = [];
  h.dbReads = 0;
  h.secondFactorOk = false;
});

describe("authorizeCredentials throttling", () => {
  it("rejects malformed input before touching any limit or the database", async () => {
    await expect(authorizeCredentials({ email: "nope", password: "" })).resolves.toBeNull();
    expect(h.increments).toEqual([]);
    expect(h.dbReads).toBe(0);
  });

  it("counts every attempt per IP and per (address, IP), and only peeks the address-wide failure cap", async () => {
    await verifiedUser();
    await authorizeCredentials({ email: EMAIL, password: PASSWORD });
    expect(h.increments).toEqual([`signin-ip:${h.ip}`, `signin:${EMAIL}:${h.ip}`]);
    expect(h.peeks).toEqual([failureKey]);
  });

  it("refuses loudly, before the user lookup, when the IP is over its limit", async () => {
    h.blocked.add("signin-ip");
    await expect(authorizeCredentials({ email: EMAIL, password: PASSWORD })).rejects.toBeInstanceOf(SignInRateLimitedError);
    expect(h.dbReads).toBe(0);
    expect(h.log.warn).toHaveBeenCalledWith(expect.objectContaining({ event: "auth.credentials.ip_rate_limited" }));
  });

  it("refuses when this address is over its limit from this IP", async () => {
    h.blocked.add("signin");
    await expect(authorizeCredentials({ email: EMAIL, password: PASSWORD })).rejects.toBeInstanceOf(SignInRateLimitedError);
    expect(h.dbReads).toBe(0);
  });

  it("refuses when the address-wide failure cap is reached, even from a fresh IP", async () => {
    h.failurePeekBlocked = true;
    h.ip = "203.0.113.200";
    await expect(authorizeCredentials({ email: EMAIL, password: PASSWORD })).rejects.toBeInstanceOf(SignInRateLimitedError);
    expect(h.dbReads).toBe(0);
  });

  it("counts a wrong password and an unknown address as failures", async () => {
    await verifiedUser();
    await expect(authorizeCredentials({ email: EMAIL, password: "wrong" })).resolves.toBeNull();
    h.user = null;
    await expect(authorizeCredentials({ email: EMAIL, password: PASSWORD })).resolves.toBeNull();
    expect(h.increments.filter((k) => k === failureKey)).toHaveLength(2);
    expect(h.resets).toEqual([]);
  });

  it("on success clears only this source's window and records no failure", async () => {
    await verifiedUser();
    await expect(authorizeCredentials({ email: EMAIL, password: PASSWORD })).resolves.toMatchObject({ id: "u1", name: "Pat" });
    expect(h.resets).toEqual([`signin:${EMAIL}:${h.ip}`]);
    expect(h.increments).not.toContain(failureKey);
  });

  it("a stranger's failures from another IP use a different per-source key than the owner's", async () => {
    await verifiedUser();
    h.ip = "192.0.2.66";
    await authorizeCredentials({ email: EMAIL, password: "guess" });
    h.ip = "198.51.100.1";
    await authorizeCredentials({ email: EMAIL, password: PASSWORD });
    const sourceKeys = h.increments.filter((k) => k.startsWith("signin:"));
    expect(new Set(sourceKeys).size).toBe(2);
  });

  it("does not count an unverified account's correct password as a failure", async () => {
    await verifiedUser({ emailVerified: null });
    await expect(authorizeCredentials({ email: EMAIL, password: PASSWORD })).rejects.toBeInstanceOf(EmailUnverifiedError);
    expect(h.increments).not.toContain(failureKey);
  });

  it("asks for the second factor without counting a failure, and counts a wrong code", async () => {
    await verifiedUser({ mfaEnabledAt: new Date(), totpSecretEncrypted: "secret" });
    await expect(authorizeCredentials({ email: EMAIL, password: PASSWORD })).rejects.toBeInstanceOf(MfaRequiredError);
    expect(h.increments).not.toContain(failureKey);

    await expect(authorizeCredentials({ email: EMAIL, password: PASSWORD, totp: "000000" })).rejects.toBeInstanceOf(MfaInvalidError);
    expect(h.increments.filter((k) => k === failureKey)).toHaveLength(1);

    h.secondFactorOk = true;
    await expect(authorizeCredentials({ email: EMAIL, password: PASSWORD, totp: "123456" })).resolves.toMatchObject({ id: "u1" });
  });

  it("keeps the per-source cap at bootstrap P1.1's 5 / 15 min and the other caps looser", () => {
    expect(SIGNIN_SOURCE_RATE_LIMIT).toEqual({ limit: 5, windowSec: 900 });
    expect(SIGNIN_IP_RATE_LIMIT.limit).toBeGreaterThan(SIGNIN_SOURCE_RATE_LIMIT.limit);
    // One IP alone (5 per 15 min) can't reach the address-wide cap within its window.
    const perIpPerWindow = SIGNIN_SOURCE_RATE_LIMIT.limit * (SIGNIN_EMAIL_FAILURE_LIMIT.windowSec / SIGNIN_SOURCE_RATE_LIMIT.windowSec);
    expect(SIGNIN_EMAIL_FAILURE_LIMIT.limit).toBeGreaterThan(perIpPerWindow);
  });
});
