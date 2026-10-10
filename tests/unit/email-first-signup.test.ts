import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Email-first sign-up (beta plan D1a), run as sequences against an in-memory
// table. The residual of B1: a stranger signs up with the owner's address; the
// owner clicks the email. With email first, the only password the account can
// end up with is the one chosen on the page that email opens.

const h = vi.hoisted(() => ({
  fake: null as null | import("./helpers/fake-db").FakeDb,
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("drizzle-orm", async () => (await import("./helpers/fake-db")).fakeOperators);
vi.mock("@/lib/db/schema", async () => {
  const { fakeTable } = await import("./helpers/fake-db");
  return {
    users: fakeTable("users"),
    sessions: fakeTable("sessions"),
    verificationTokens: fakeTable("verification_tokens"),
  };
});
vi.mock("@/lib/db", () => ({
  get db() {
    return h.fake!.db;
  },
}));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("next-auth", () => ({ CredentialsSignin: class CredentialsSignin extends Error {} }));
vi.mock("@/lib/rate-limit", () => ({
  incrementRateLimit: () => Promise.resolve({ allowed: true, attempts: 1, resetAt: new Date() }),
  peekRateLimit: () => Promise.resolve({ allowed: true, attempts: 0, resetAt: new Date() }),
  resetRateLimit: () => Promise.resolve(),
}));
vi.mock("@/lib/client-ip", () => ({ clientIp: () => Promise.resolve("203.0.113.7") }));
vi.mock("@/lib/auth/mfa", () => ({ decryptSecret: (s: string) => s }));
vi.mock("@/lib/auth/mfa-verify", () => ({ verifySecondFactor: () => Promise.resolve(false) }));

import { authorizeCredentials } from "@/lib/auth/credentials-authorize";
import { checkSignUpLink, finishSignUp } from "@/lib/auth/email-first-signup";
import { secureOAuthEmailLink } from "@/lib/auth/oauth-link";
import { generateVerificationToken } from "@/lib/auth/verification-tokens";

import { createFakeDb } from "./helpers/fake-db";

const OWNER = "owner@example.org";
const STRANGER_PASSWORD = "stranger-chosen-password";
const OWNER_PASSWORD = "owner-chosen-password";

function seedRow(fields: { password?: string; emailVerified?: Date | null } = {}) {
  h.fake!.rows("users").push({
    id: "u-owner",
    email: OWNER,
    name: null,
    displayName: null,
    image: null,
    passwordHash: fields.password ? bcrypt.hashSync(fields.password, 4) : null,
    emailVerified: fields.emailVerified ?? null,
    mfaEnabledAt: null,
    totpSecretEncrypted: null,
    oauthPasswordClearedAt: null,
  });
}

/** What signUpAction stores for a link: the hash, never the plaintext. */
function emailLink(expires?: Date): string {
  const { token, tokenHash, expires: defaultExpires } = generateVerificationToken();
  h.fake!.rows("verification_tokens").push({ identifier: OWNER, token: tokenHash, expires: expires ?? defaultExpires });
  return token;
}

const row = () => h.fake!.rows("users")[0]!;
const finish = async (token: string, password = OWNER_PASSWORD) =>
  finishSignUp({ email: OWNER, token, passwordHash: await bcrypt.hash(password, 4) });

beforeEach(() => {
  vi.clearAllMocks();
  h.fake = createFakeDb();
});

describe("a stranger signs up with the owner's address", () => {
  it("leaves no password anywhere until the owner chooses one from the email", async () => {
    seedRow(); // what email-first signUpAction inserts
    const token = emailLink();
    await expect(authorizeCredentials({ email: OWNER, password: STRANGER_PASSWORD })).resolves.toBeNull();

    expect(await finish(token)).toBe("u-owner");
    expect(row().emailVerified).toBeInstanceOf(Date);
    await expect(authorizeCredentials({ email: OWNER, password: OWNER_PASSWORD })).resolves.toMatchObject({ id: "u-owner" });
    await expect(authorizeCredentials({ email: OWNER, password: STRANGER_PASSWORD })).resolves.toBeNull();
  });

  it("replaces a password a stranger set before email-first sign-up shipped", async () => {
    seedRow({ password: STRANGER_PASSWORD });
    const token = emailLink();
    await finish(token);
    await expect(authorizeCredentials({ email: OWNER, password: STRANGER_PASSWORD })).resolves.toBeNull();
    await expect(authorizeCredentials({ email: OWNER, password: OWNER_PASSWORD })).resolves.toMatchObject({ id: "u-owner" });
  });
});

describe("the link", () => {
  it("survives being opened (mail scanners fetch it), and works once", async () => {
    seedRow();
    const token = emailLink();
    expect(await checkSignUpLink(OWNER, token)).toBe("ok");
    expect(await checkSignUpLink(OWNER, token)).toBe("ok");
    expect(await finish(token)).toBe("u-owner");
    expect(await checkSignUpLink(OWNER, token)).toBe("invalid");
    expect(await finish(token, STRANGER_PASSWORD)).toBeNull();
    await expect(authorizeCredentials({ email: OWNER, password: OWNER_PASSWORD })).resolves.toMatchObject({ id: "u-owner" });
  });

  it("is refused when expired, for another address, or with a wrong token", async () => {
    seedRow();
    const expired = emailLink(new Date(Date.now() - 1000));
    expect(await checkSignUpLink(OWNER, expired)).toBe("expired");
    expect(await finish(expired)).toBeNull();
    const live = emailLink();
    expect(await checkSignUpLink("other@example.org", live)).toBe("invalid");
    expect(await finishSignUp({ email: "other@example.org", token: live, passwordHash: "x" })).toBeNull();
    expect(await checkSignUpLink(OWNER, "0".repeat(64))).toBe("invalid");
    expect(row().passwordHash).toBeNull();
  });

  it("can't set the password of an account that is already verified", async () => {
    seedRow({ password: OWNER_PASSWORD, emailVerified: new Date("2026-01-01") });
    const token = emailLink();
    expect(await finish(token, STRANGER_PASSWORD)).toBeNull();
    await expect(authorizeCredentials({ email: OWNER, password: OWNER_PASSWORD })).resolves.toMatchObject({ id: "u-owner" });
  });
});

describe("Google before the link is used", () => {
  it("verifies the pending sign-up, burns the link, and has no password to report", async () => {
    seedRow();
    const token = emailLink();
    await secureOAuthEmailLink(OWNER);
    expect(row().emailVerified).toBeInstanceOf(Date);
    expect(row().oauthPasswordClearedAt).toBeNull();
    expect(h.log.warn).not.toHaveBeenCalled();
    expect(await finish(token, STRANGER_PASSWORD)).toBeNull();
  });
});
