import { beforeEach, describe, expect, it, vi } from "vitest";

// The Auth.js signIn callback in lib/auth.ts: an OAuth sign-in proves the email
// only when the provider itself verified it. Refused before any row is linked
// or changed; a verified one secures an unverified row first (beta blocker B1).

type SignIn = (args: {
  user: { email?: string | null };
  account: { type: string; provider: string } | null;
  profile?: unknown;
}) => Promise<boolean>;

const h = vi.hoisted(() => ({
  config: null as null | {
    callbacks: {
      signIn: SignIn;
      jwt: (p: { token: Record<string, unknown>; account?: { provider: string } | null; user?: Record<string, unknown> }) => Promise<Record<string, unknown>>;
    };
  },
  secure: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("next-auth", () => ({
  default: (config: NonNullable<typeof h.config>) => {
    h.config = config;
    return { handlers: {}, signIn: vi.fn(), signOut: vi.fn(), auth: vi.fn() };
  },
}));
vi.mock("next-auth/jwt", () => ({ encode: vi.fn() }));
vi.mock("next-auth/providers/credentials", () => ({ default: (c: unknown) => c }));
vi.mock("next-auth/providers/google", () => ({ default: (c: unknown) => c }));
// lib/auth wraps the adapter's session methods (lib/auth/session-adapter.ts)
// and linkAccount (lib/auth/oauth-tokens.ts), each refusing an adapter
// without them; these tests never call them.
vi.mock("@auth/drizzle-adapter", () => ({
  DrizzleAdapter: () => ({
    linkAccount: vi.fn(),
    createSession: vi.fn(),
    getSessionAndUser: vi.fn(),
    updateSession: vi.fn(),
    deleteSession: vi.fn(),
  }),
}));
vi.mock("@/lib/avserv/account-link", () => ({ mapUserToAvServAccountOnLogin: vi.fn() }));
vi.mock("@/lib/auth/credentials-authorize", () => ({ authorizeCredentials: vi.fn() }));
vi.mock("@/lib/auth/oauth-link", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/oauth-link")>()),
  secureOAuthEmailLink: h.secure,
  markOAuthUserVerified: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/schema", () => ({ users: {}, accounts: {}, sessions: {}, verificationTokens: {} }));
vi.mock("@/lib/env", () => ({ env: { GOOGLE_CLIENT_ID: "x", GOOGLE_CLIENT_SECRET: "x", NEXTAUTH_SECRET: "x" } }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));

import "@/lib/auth";
import { oauthEmailVerified } from "@/lib/auth/oauth-link";

const signIn = (profile: unknown, email: string | null = "pat@example.org") =>
  h.config!.callbacks.signIn({ user: { email }, account: { type: "oauth", provider: "google" }, profile });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("oauthEmailVerified", () => {
  it("accepts only Google's boolean true", () => {
    expect(oauthEmailVerified("google", { email_verified: true })).toBe(true);
    for (const claim of [false, "true", 1, undefined, null]) {
      expect(oauthEmailVerified("google", { email_verified: claim })).toBe(false);
    }
    expect(oauthEmailVerified("google", undefined)).toBe(false);
  });

  it("refuses a provider nobody has reviewed", () => {
    expect(oauthEmailVerified("apple", { email_verified: true })).toBe(false);
  });
});

describe("signIn callback", () => {
  it("refuses a Google account whose email Google hasn't verified, before touching any row", async () => {
    expect(await signIn({ email_verified: false })).toBe(false);
    expect(await signIn({})).toBe(false);
    expect(h.secure).not.toHaveBeenCalled();
    expect(h.log.warn).toHaveBeenCalledWith(expect.objectContaining({ event: "auth.oauth.email_unverified", provider: "google" }));
  });

  it("secures the row and allows a verified Google sign-in", async () => {
    expect(await signIn({ email_verified: true })).toBe(true);
    expect(h.secure).toHaveBeenCalledWith("pat@example.org");
  });

  it("leaves credentials sign-in alone", async () => {
    expect(await h.config!.callbacks.signIn({ user: { email: "pat@example.org" }, account: { type: "credentials", provider: "credentials" } })).toBe(true);
    expect(h.secure).not.toHaveBeenCalled();
  });
});

describe("jwt callback", () => {
  it("carries how a credentials sign-in met its second factor, for the session row", async () => {
    const token = await h.config!.callbacks.jwt({
      token: {},
      account: { provider: "credentials" },
      user: { id: "u1", authMethod: "passkey", passkeyId: "pk-1" },
    });
    expect(token).toMatchObject({ credentials: true, sub: "u1", authMethod: "passkey", passkeyId: "pk-1" });
  });

  it("defaults a credentials sign-in to a password one, and leaves Google alone", async () => {
    expect(await h.config!.callbacks.jwt({ token: {}, account: { provider: "credentials" }, user: { id: "u1" } })).toMatchObject({
      authMethod: "password",
      passkeyId: null,
    });
    expect(await h.config!.callbacks.jwt({ token: {}, account: { provider: "google" }, user: { id: "u1" } })).not.toHaveProperty("authMethod");
  });
});
