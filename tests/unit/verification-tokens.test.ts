import { beforeEach, describe, expect, it, vi } from "vitest";

// Email-verification tokens are stored as SHA-256 hashes (CLAUDE.md §7), like
// password-reset tokens: the plaintext lives only in the emailed link, so a
// read of verification_tokens can't be replayed into verifying an address.

const h = vi.hoisted(() => ({
  fake: null as null | import("./helpers/fake-db").FakeDb,
  sendVerification: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("drizzle-orm", async () => (await import("./helpers/fake-db")).fakeOperators);
vi.mock("@/lib/db/schema", async () => {
  const { fakeTable } = await import("./helpers/fake-db");
  return {
    users: fakeTable("users"),
    sessions: fakeTable("sessions"),
    verificationTokens: fakeTable("verification_tokens"),
    passwordResetTokens: fakeTable("password_reset_tokens"),
  };
});
vi.mock("@/lib/db", () => ({
  get db() {
    return h.fake!.db;
  },
}));
vi.mock("next-auth", () => ({ AuthError: class extends Error {}, CredentialsSignin: class extends Error {} }));
vi.mock("@/lib/auth", () => ({ signIn: vi.fn(), signOut: vi.fn() }));
vi.mock("@/lib/email/send", () => ({ sendVerificationEmail: h.sendVerification, sendPasswordResetEmail: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  incrementRateLimit: () => Promise.resolve({ allowed: true, attempts: 1, resetAt: new Date() }),
}));
vi.mock("@/lib/client-ip", () => ({ clientIp: () => Promise.resolve("203.0.113.1") }));
vi.mock("@/lib/env", () => ({ env: { NEXTAUTH_URL: "https://rmdig.ai" } }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("bcryptjs", () => ({ default: { hash: () => Promise.resolve("bcrypt-hash") } }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));

import { signUpAction } from "@/app/(auth)/actions";
import { GET as verify } from "@/app/api/verify/route";
import {
  generateVerificationToken,
  hashVerificationToken,
  VERIFICATION_TOKEN_TTL_HOURS,
} from "@/lib/auth/verification-tokens";

import { createFakeDb } from "./helpers/fake-db";

const EMAIL = "pat@example.org";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function signUpAndGetLinkToken(): Promise<string> {
  const res = await signUpAction(
    null,
    form({ email: EMAIL, password: "a-long-password-1", confirmPassword: "a-long-password-1", intent: "explorer" }),
  );
  expect(res).toEqual({ ok: true });
  const link = new URL(h.sendVerification.mock.calls[0]![1] as string);
  return link.searchParams.get("token")!;
}

const callVerify = (token: string) =>
  verify(new Request(`https://rmdig.ai/api/verify?token=${token}&email=${encodeURIComponent(EMAIL)}`)).catch(
    (e: { url?: string }) => e.url,
  );

beforeEach(() => {
  vi.clearAllMocks();
  h.fake = createFakeDb();
  h.sendVerification.mockResolvedValue(undefined);
});

describe("verification-token helpers", () => {
  it("generates 256-bit hex tokens whose stored form is their SHA-256", () => {
    const { token, tokenHash, expires } = generateVerificationToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).toBe(hashVerificationToken(token));
    expect(tokenHash).not.toBe(token);
    const ttlMs = expires.getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan((VERIFICATION_TOKEN_TTL_HOURS * 60 - 1) * 60 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(VERIFICATION_TOKEN_TTL_HOURS * 60 * 60 * 1000);
  });
});

describe("sign-up → verify link", () => {
  it("stores only the hash of the emailed token", async () => {
    const linkToken = await signUpAndGetLinkToken();
    const stored = h.fake!.rows("verification_tokens");
    expect(stored).toHaveLength(1);
    expect(stored[0]!.token).toBe(hashVerificationToken(linkToken));
    expect(stored[0]!.token).not.toBe(linkToken);
  });

  it("verifies the account from the emailed token and burns it", async () => {
    const linkToken = await signUpAndGetLinkToken();
    expect(await callVerify(linkToken)).toBe("/sign-in?verified=true");
    expect(h.fake!.rows("users")[0]!.emailVerified).toBeInstanceOf(Date);
    expect(h.fake!.rows("verification_tokens")).toHaveLength(0);
  });

  it("rejects the stored hash used as a link token (a DB read can't be replayed)", async () => {
    await signUpAndGetLinkToken();
    const storedHash = h.fake!.rows("verification_tokens")[0]!.token as string;
    expect(await callVerify(storedHash)).toBe("/sign-in?error=invalid-token");
    expect(h.fake!.rows("users")[0]!.emailVerified ?? null).toBeNull();
  });
});
