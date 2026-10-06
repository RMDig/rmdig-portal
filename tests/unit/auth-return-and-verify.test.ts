import { beforeEach, describe, expect, it, vi } from "vitest";

// After sign-in you return to where you were headed (an invite, an account-
// review link), never to another site; an unverified account can get a new
// verification link without anything about the account changing.

const h = vi.hoisted(() => {
  class FakeAuthError extends Error {}
  class FakeCredentialsSignin extends FakeAuthError {
    code = "credentials";
  }
  return {
    FakeAuthError,
    FakeCredentialsSignin,
    signInCalls: [] as Array<{ provider: string; options: Record<string, unknown> }>,
    user: [] as Array<{ id: string; emailVerified: Date | null }>,
    rlAllowed: true,
    deletes: 0,
    inserts: [] as unknown[],
    updates: 0,
    sendVerification: vi.fn(),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    verifyRow: [] as unknown[],
  };
});

vi.mock("next-auth", () => ({ AuthError: h.FakeAuthError, CredentialsSignin: h.FakeCredentialsSignin }));
vi.mock("@/lib/auth", () => ({
  signIn: (provider: string, options: Record<string, unknown>) => {
    h.signInCalls.push({ provider, options });
    return Promise.resolve();
  },
  signOut: vi.fn(),
}));
vi.mock("@/lib/db", () => {
  const sel: Record<string, unknown> = {};
  sel.from = () => sel;
  sel.where = () => sel;
  sel.limit = () => Promise.resolve(h.user.length ? h.user : h.verifyRow);
  return {
    db: {
      select: () => sel,
      delete: () => ({ where: () => (h.deletes++, Promise.resolve()) }),
      insert: () => ({
        values: (v: unknown) => {
          h.inserts.push(v);
          return Object.assign(Promise.resolve(), { returning: () => Promise.resolve([{ id: "new-user" }]) });
        },
      }),
      update: () => ({ set: () => ({ where: () => (h.updates++, Promise.resolve()) }) }),
    },
  };
});
vi.mock("@/lib/db/schema", () => ({ users: {}, verificationTokens: {}, passwordResetTokens: {}, sessions: {} }));
vi.mock("@/lib/email/send", () => ({ sendVerificationEmail: h.sendVerification, sendPasswordResetEmail: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ incrementRateLimit: () => Promise.resolve({ allowed: h.rlAllowed, attempts: 1 }) }));
vi.mock("@/lib/client-ip", () => ({ clientIp: () => Promise.resolve("203.0.113.1") }));
vi.mock("@/lib/env", () => ({ env: { NEXTAUTH_URL: "https://rmdig.ai" } }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("@/lib/auth/reset-tokens", () => ({ generateResetToken: vi.fn(), hashResetToken: vi.fn() }));
vi.mock("bcryptjs", () => ({ default: { hash: () => Promise.resolve("hash") } }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));

import { resendVerificationAction, signInCredentialsAction, signInGoogleAction, signUpAction } from "@/app/(auth)/actions";
import { GET as verify } from "@/app/api/verify/route";

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};
const SIGNUP = { email: "pat@example.org", password: "a-long-password-1", confirmPassword: "a-long-password-1", intent: "explorer" };

beforeEach(() => {
  vi.clearAllMocks();
  h.signInCalls = [];
  h.user = [];
  h.verifyRow = [];
  h.rlAllowed = true;
  h.deletes = 0;
  h.inserts = [];
  h.updates = 0;
  h.sendVerification.mockResolvedValue(undefined);
});

describe("return path after sign-in", () => {
  it("goes to a safe next, and to the dashboard for anything else", async () => {
    await signInCredentialsAction(null, form({ email: "a@b.co", password: "pw", next: "/invite/tok" }));
    await signInCredentialsAction(null, form({ email: "a@b.co", password: "pw", next: "https://evil.example" }));
    await signInGoogleAction(form({ next: "/account/review?restriction=r1" }));
    await signInGoogleAction(form({ next: "//evil.example" }));
    expect(h.signInCalls.map((c) => c.options.redirectTo)).toEqual(["/invite/tok", "/dashboard", "/account/review?restriction=r1", "/dashboard"]);
  });
});

describe("verification links", () => {
  it("a new sign-up's link carries a safe next", async () => {
    h.user = [];
    expect(await signUpAction(null, form({ ...SIGNUP, next: "/invite/tok" }))).toEqual({ ok: true });
    expect(h.sendVerification.mock.calls[0]![1]).toContain("&next=%2Finvite%2Ftok");
  });

  it("signing up again with an unverified address re-sends the link and changes nothing else", async () => {
    h.user = [{ id: "u1", emailVerified: null }];
    expect(await signUpAction(null, form(SIGNUP))).toEqual({ ok: true });
    expect(h.sendVerification).toHaveBeenCalledTimes(1);
    expect(h.updates).toBe(0); // never the password
    expect(h.deletes).toBe(1); // the earlier link is replaced
  });

  it("gives a verified address the same answer and sends nothing", async () => {
    h.user = [{ id: "u1", emailVerified: new Date() }];
    expect(await signUpAction(null, form(SIGNUP))).toEqual({ ok: true });
    expect(await resendVerificationAction(null, form({ email: SIGNUP.email }))).toEqual({ ok: true });
    expect(h.sendVerification).not.toHaveBeenCalled();
  });

  it("'Send a new link' answers the same for unknown, rate-limited and failed sends, logging the failure", async () => {
    expect(await resendVerificationAction(null, form({ email: "nobody@example.org" }))).toEqual({ ok: true });
    h.user = [{ id: "u1", emailVerified: null }];
    h.sendVerification.mockRejectedValueOnce(new Error("resend down"));
    expect(await resendVerificationAction(null, form({ email: SIGNUP.email }))).toEqual({ ok: true });
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "verify.resend_failed" }));
    h.rlAllowed = false;
    expect(await resendVerificationAction(null, form({ email: SIGNUP.email }))).toMatchObject({ ok: false, error: expect.stringMatching(/Too many/) });
  });
});

describe("GET /api/verify", () => {
  const call = (qs: string) =>
    verify(new Request(`https://rmdig.ai/api/verify?${qs}`)).catch((e: { url?: string }) => e.url);

  it("forwards a safe next to sign-in, on success and on errors, and drops an unsafe one", async () => {
    h.verifyRow = [{ expires: new Date(Date.now() + 60_000) }];
    expect(await call("token=t&email=pat%40example.org&next=%2Finvite%2Ftok")).toBe("/sign-in?verified=true&next=%2Finvite%2Ftok");
    expect(await call("token=t&email=pat%40example.org&next=https%3A%2F%2Fevil.example")).toBe("/sign-in?verified=true");
    h.verifyRow = [];
    expect(await call("token=t&email=pat%40example.org&next=%2Finvite%2Ftok")).toBe("/sign-in?error=invalid-token&next=%2Finvite%2Ftok");
  });
});
