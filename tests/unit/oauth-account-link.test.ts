import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Beta blocker B1 (owner decision D1: keep Google auto-linking). A stranger signs
// up with the victim's address and their own password; the row stays
// unverified. The victim later signs in with Google, which links into that row.
// Before the fix the link marked the row verified and the stranger's password
// started working. These tests run the sequence against an in-memory table so
// they exercise state, not canned return values.

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
// Throttling is covered in credentials-authorize.test.ts; here it always allows.
vi.mock("@/lib/rate-limit", () => ({
  incrementRateLimit: () => Promise.resolve({ allowed: true, attempts: 1, resetAt: new Date() }),
  peekRateLimit: () => Promise.resolve({ allowed: true, attempts: 0, resetAt: new Date() }),
  resetRateLimit: () => Promise.resolve(),
}));
vi.mock("@/lib/client-ip", () => ({ clientIp: () => Promise.resolve("203.0.113.7") }));
vi.mock("@/lib/auth/mfa", () => ({ decryptSecret: (s: string) => s }));
vi.mock("@/lib/auth/mfa-verify", () => ({ verifySecondFactor: () => Promise.resolve(false) }));

import { authorizeCredentials, EmailUnverifiedError } from "@/lib/auth/credentials-authorize";
import { markOAuthUserVerified, secureOAuthEmailLink } from "@/lib/auth/oauth-link";

import { createFakeDb } from "./helpers/fake-db";

const VICTIM = "victim@example.org";
const ATTACKER_PASSWORD = "attacker-chosen-password";
const OWNER_PASSWORD = "owner-chosen-password";

async function seedUser(fields: { id: string; password?: string; emailVerified: Date | null }) {
  h.fake!.rows("users").push({
    id: fields.id,
    email: VICTIM,
    name: null,
    displayName: null,
    image: null,
    passwordHash: fields.password ? await bcrypt.hash(fields.password, 4) : null,
    emailVerified: fields.emailVerified,
    mfaEnabledAt: null,
    totpSecretEncrypted: null,
  });
}

const userRow = () => h.fake!.rows("users")[0]!;

beforeEach(() => {
  vi.clearAllMocks();
  h.fake = createFakeDb();
});

describe("Google sign-in linking into an unverified credentials row (the attack)", () => {
  beforeEach(async () => {
    // Step 1: the stranger signs up with the victim's address (the row signUpAction
    // writes), and a verification link is pending in the victim's inbox.
    await seedUser({ id: "u-victim", password: ATTACKER_PASSWORD, emailVerified: null });
    h.fake!.rows("verification_tokens").push({ identifier: VICTIM, token: "hash", expires: new Date(Date.now() + 1e6) });
    h.fake!.rows("verification_tokens").push({ identifier: "other@example.org", token: "hash2", expires: new Date(Date.now() + 1e6) });
    h.fake!.rows("sessions").push({ sessionToken: "s-old", userId: "u-victim", expires: new Date(Date.now() + 1e6) });
    h.fake!.rows("sessions").push({ sessionToken: "s-other", userId: "u-other", expires: new Date(Date.now() + 1e6) });
  });

  it("leaves the stranger's password unable to sign in once the victim links Google", async () => {
    // Before the link, the password is blocked only by verification.
    await expect(authorizeCredentials({ email: VICTIM, password: ATTACKER_PASSWORD })).rejects.toBeInstanceOf(EmailUnverifiedError);

    // Step 2: the victim signs in with Google (the signIn callback runs this).
    await secureOAuthEmailLink(VICTIM);

    // Step 3: the stranger tries their password on the now-verified row.
    expect(userRow().emailVerified).toBeInstanceOf(Date);
    expect(userRow().passwordHash).toBeNull();
    await expect(authorizeCredentials({ email: VICTIM, password: ATTACKER_PASSWORD })).resolves.toBeNull();
  });

  it("deletes the row's sessions and pending verification links, and nobody else's", async () => {
    await secureOAuthEmailLink(VICTIM);
    expect(h.fake!.rows("sessions").map((s) => s.sessionToken)).toEqual(["s-other"]);
    expect(h.fake!.rows("verification_tokens").map((t) => t.identifier)).toEqual(["other@example.org"]);
    expect(h.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "auth.oauth_link.unverified_row_secured", userId: "u-victim" }),
    );
  });

  it("is idempotent: a second Google sign-in changes nothing more", async () => {
    await secureOAuthEmailLink(VICTIM);
    const verifiedAt = userRow().emailVerified;
    h.fake!.rows("sessions").push({ sessionToken: "s-google", userId: "u-victim", expires: new Date(Date.now() + 1e6) });
    await secureOAuthEmailLink(VICTIM);
    expect(userRow().emailVerified).toBe(verifiedAt);
    expect(h.fake!.rows("sessions").map((s) => s.sessionToken)).toContain("s-google");
  });
});

describe("legitimate flows still work", () => {
  it("Google-only: a first-time user has no row to secure, and the new row is marked verified on link", async () => {
    await secureOAuthEmailLink(VICTIM);
    expect(h.fake!.rows("users")).toHaveLength(0);

    // The adapter then creates the row unverified and links the account.
    await seedUser({ id: "u-google", emailVerified: null });
    await markOAuthUserVerified("u-google");
    expect(userRow().emailVerified).toBeInstanceOf(Date);
    expect(userRow().passwordHash).toBeNull();
  });

  it("credentials-only: a verified password user signs in as before", async () => {
    await seedUser({ id: "u-owner", password: OWNER_PASSWORD, emailVerified: new Date("2026-01-01") });
    await expect(authorizeCredentials({ email: VICTIM, password: OWNER_PASSWORD })).resolves.toMatchObject({
      id: "u-owner",
      email: VICTIM,
    });
  });

  it("verified credentials, then Google: the owner's password and sessions survive the link", async () => {
    const verifiedAt = new Date("2026-01-01");
    await seedUser({ id: "u-owner", password: OWNER_PASSWORD, emailVerified: verifiedAt });
    h.fake!.rows("sessions").push({ sessionToken: "s-laptop", userId: "u-owner", expires: new Date(Date.now() + 1e6) });

    await secureOAuthEmailLink(VICTIM);
    await markOAuthUserVerified("u-owner");

    expect(userRow().emailVerified).toBe(verifiedAt);
    expect(h.fake!.rows("sessions")).toHaveLength(1);
    expect(h.log.warn).not.toHaveBeenCalled();
    await expect(authorizeCredentials({ email: VICTIM, password: OWNER_PASSWORD })).resolves.toMatchObject({ id: "u-owner" });
  });
});
