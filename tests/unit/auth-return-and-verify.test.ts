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
    finishSignUp: vi.fn(),
    advertiserPortal: false,
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
vi.mock("@/lib/features", () => ({ featureEnabled: () => h.advertiserPortal }));
vi.mock("@/lib/auth/email-first-signup", () => ({ finishSignUp: h.finishSignUp }));
vi.mock("@/lib/auth/reset-tokens", () => ({ generateResetToken: vi.fn(), hashResetToken: vi.fn() }));
vi.mock("bcryptjs", () => ({ default: { hash: () => Promise.resolve("hash") } }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));

import {
  finishSignUpAction,
  resendVerificationAction,
  signInCredentialsAction,
  signInGoogleAction,
  signUpAction,
  signUpGoogleAction,
} from "@/app/(auth)/actions";
import { GET as verify } from "@/app/api/verify/route";

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};
const SIGNUP = { email: "pat@example.org", intent: "explorer" };
const FINISH = { email: "pat@example.org", token: "t", password: "a-long-password-1", confirmPassword: "a-long-password-1" };

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
  h.finishSignUp.mockResolvedValue("u1");
  h.advertiserPortal = false;
});

describe("return path after sign-in", () => {
  it("goes to a safe next, and to the dashboard for anything else", async () => {
    await signInCredentialsAction(null, form({ email: "a@b.co", password: "pw", next: "/invite/tok" }));
    await signInCredentialsAction(null, form({ email: "a@b.co", password: "pw", next: "https://evil.example" }));
    await signInGoogleAction(form({ next: "/account/review?restriction=r1" }));
    await signInGoogleAction(form({ next: "//evil.example" }));
    expect(h.signInCalls.map((c) => c.options.redirectTo)).toEqual(["/invite/tok", "/dashboard", "/account/review?restriction=r1", "/dashboard"]);
  });

  it("Google from the sign-up page lands on the intent's onboarding form, unless next says otherwise", async () => {
    await signUpGoogleAction(form({ intent: "sar" }));
    await signUpGoogleAction(form({ intent: "advertiser" }));
    h.advertiserPortal = true;
    await signUpGoogleAction(form({ intent: "advertiser" }));
    await signUpGoogleAction(form({ intent: "superuser" }));
    await signUpGoogleAction(form({ intent: "sar", next: "/invite/tok" }));
    expect(h.signInCalls.map((c) => [c.provider, c.options.redirectTo])).toEqual([
      ["google", "/sar/new"],
      ["google", "/dashboard"], // advertiser portal off
      ["google", "/advertiser/new"],
      ["google", "/dashboard"],
      ["google", "/invite/tok"],
    ]);
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

describe("finishing sign-up", () => {
  it("sets the password through the link and reports success", async () => {
    expect(await finishSignUpAction(null, form(FINISH))).toEqual({ ok: true });
    expect(h.finishSignUp).toHaveBeenCalledWith({ email: FINISH.email, token: "t", passwordHash: "hash" });
  });

  it("refuses a short or mismatched password without touching the link", async () => {
    const short = await finishSignUpAction(null, form({ ...FINISH, password: "short", confirmPassword: "short" }));
    const mismatch = await finishSignUpAction(null, form({ ...FINISH, confirmPassword: "a-long-password-2" }));
    expect(short).toMatchObject({ ok: false, fieldErrors: { password: expect.any(Array) } });
    expect(mismatch).toMatchObject({ ok: false, fieldErrors: { confirmPassword: expect.any(Array) } });
    expect(h.finishSignUp).not.toHaveBeenCalled();
  });

  it("says so when the link is used up or expired", async () => {
    h.finishSignUp.mockResolvedValueOnce(null);
    expect(await finishSignUpAction(null, form(FINISH))).toMatchObject({ ok: false, error: expect.stringMatching(/expired or was already used/) });
  });
});

describe("GET /api/verify (links sent before email-first sign-up)", () => {
  const call = (qs: string) =>
    verify(new Request(`https://rmdig.ai/api/verify?${qs}`)).catch((e: { url?: string }) => e.url);

  it("forwards to the password page without using the link up", async () => {
    expect(await call("token=t&email=pat%40example.org&next=%2Finvite%2Ftok")).toBe(
      "/sign-up/finish?token=t&email=pat%40example.org&next=%2Finvite%2Ftok",
    );
    expect(h.deletes).toBe(0);
    expect(h.updates).toBe(0);
  });
});
