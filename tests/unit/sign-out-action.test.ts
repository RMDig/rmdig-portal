import { beforeEach, describe, expect, it, vi } from "vitest";

// signOutAction ends the Auth.js session and sends the user to /sign-in. It
// has no gate of its own (signing out is always allowed); what matters is that
// a failure to end the session surfaces instead of looking like a sign-out.

const h = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock("@/lib/auth", () => ({ signIn: vi.fn(), signOut: h.signOut }));
vi.mock("next-auth", () => ({
  AuthError: class AuthError extends Error {},
  CredentialsSignin: class CredentialsSignin extends Error {},
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/email/send", () => ({ sendPasswordResetEmail: vi.fn(), sendVerificationEmail: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ incrementRateLimit: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(new Headers()) }));

import { signOutAction, signOutAndContinueAction } from "@/app/(auth)/actions";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("signOutAction", () => {
  it("ends the session and redirects to /sign-in", async () => {
    h.signOut.mockResolvedValue(undefined);
    await expect(signOutAction()).resolves.toBeUndefined();
    expect(h.signOut).toHaveBeenCalledWith({ redirectTo: "/sign-in" });
  });

  it("lets a failure to end the session through, rather than swallowing it", async () => {
    h.signOut.mockRejectedValue(new Error("session delete failed"));
    await expect(signOutAction()).rejects.toThrow("session delete failed");
  });
});

describe("signOutAndContinueAction", () => {
  function fd(next: string): FormData {
    const f = new FormData();
    f.set("next", next);
    return f;
  }

  it("signs out and returns to the page after the next sign-in", async () => {
    h.signOut.mockResolvedValue(undefined);
    await signOutAndContinueAction(fd("/invite/abc123"));
    expect(h.signOut).toHaveBeenCalledWith({ redirectTo: "/sign-in?next=%2Finvite%2Fabc123" });
  });

  it("drops an off-site return address instead of following it", async () => {
    h.signOut.mockResolvedValue(undefined);
    await signOutAndContinueAction(fd("https://evil.example/phish"));
    expect(h.signOut).toHaveBeenCalledWith({ redirectTo: "/sign-in" });
  });
});
