import { beforeEach, describe, expect, it, vi } from "vitest";

// Stub next-auth's error classes so the action's instanceof checks work without
// loading the real next-auth runtime. Defined in vi.hoisted so they exist when
// the hoisted vi.mock factory below runs.
const h = vi.hoisted(() => {
  class FakeAuthError extends Error {}
  class FakeCredentialsSignin extends FakeAuthError {
    code = "credentials";
  }
  return {
    FakeAuthError,
    FakeCredentialsSignin,
    signInError: null as Error | null,
  };
});

vi.mock("next-auth", () => ({
  AuthError: h.FakeAuthError,
  CredentialsSignin: h.FakeCredentialsSignin,
}));
vi.mock("@/lib/auth", () => ({
  signIn: () => {
    if (h.signInError) throw h.signInError;
    return Promise.resolve();
  },
  signOut: vi.fn(),
}));
// Module-load dependencies of actions.ts — stubbed so import succeeds.
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/schema", () => ({ users: {}, verificationTokens: {}, passwordResetTokens: {}, sessions: {} }));
vi.mock("@/lib/email/send", () => ({ sendVerificationEmail: vi.fn(), sendPasswordResetEmail: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ incrementRateLimit: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/auth/reset-tokens", () => ({
  generateResetToken: vi.fn(),
  hashResetToken: vi.fn(),
}));

import { signInCredentialsAction } from "@/app/(auth)/actions";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

function credError(code: string): Error {
  const e = new h.FakeCredentialsSignin();
  e.code = code;
  return e;
}

beforeEach(() => {
  h.signInError = null;
});

describe("signInCredentialsAction MFA handling", () => {
  it("validates input before calling signIn", async () => {
    const res = await signInCredentialsAction(null, form({ email: "bad", password: "" }));
    expect(res.ok).toBe(false);
  });

  it("signals mfaRequired when the password is right but a code is needed", async () => {
    h.signInError = credError("mfa_required");
    const res = await signInCredentialsAction(null, form({ email: "a@b.co", password: "pw" }));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.mfaRequired).toBe(true);
      expect(res.error).toMatch(/authenticator/i);
    }
  });

  it("signals mfaRequired with a retry message on a bad code", async () => {
    h.signInError = credError("mfa_invalid");
    const res = await signInCredentialsAction(
      null,
      form({ email: "a@b.co", password: "pw", totp: "000000" }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.mfaRequired).toBe(true);
      expect(res.error).toMatch(/didn't match/i);
    }
  });

  it("shows a generic message for bad credentials (no mfa flag)", async () => {
    h.signInError = credError("credentials");
    const res = await signInCredentialsAction(null, form({ email: "a@b.co", password: "pw" }));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.mfaRequired).toBeFalsy();
      expect(res.error).toMatch(/invalid email or password/i);
    }
  });
});
