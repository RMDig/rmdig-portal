import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  actor: { ok: true, userId: "u1" } as { ok: true; userId: string } | { ok: false; error: string },
  verifyError: null as string | null,
  marked: true,
  current: "11111111-1111-4111-8111-111111111111" as string | null,
  redirects: [] as string[],
  signIns: [] as unknown[][],
  // For the complete route.
  session: { user: { id: "u1" } } as null | { user: { id: string } },
  recent: { ok: true, sessionId: "33333333-3333-4333-8333-333333333333" } as
    | { ok: true; sessionId: string }
    | { ok: false; reauth: true },
  revoked: [] as unknown[][],
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

class Redirect extends Error {
  constructor(public to: string) {
    super(`redirect ${to}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    h.redirects.push(to);
    throw new Redirect(to);
  },
}));
vi.mock("@/lib/auth", () => ({
  signIn: (...args: unknown[]) => {
    h.signIns.push(args);
    return Promise.resolve();
  },
  auth: () => Promise.resolve(h.session),
}));
vi.mock("@/lib/auth/portal-actor", () => ({ portalActor: () => Promise.resolve(h.actor) }));
vi.mock("@/lib/auth/reauth", () => ({ verifyPasswordReauth: () => Promise.resolve(h.verifyError) }));
vi.mock("@/lib/auth/recent-auth", () => ({
  markRecentAuth: () => Promise.resolve(h.marked),
  requireRecentAuth: () => Promise.resolve(h.recent),
}));
vi.mock("@/lib/auth/sessions", () => ({
  currentSessionId: () => Promise.resolve(h.current),
  revokeSession: (_db: unknown, userId: string, id: string) => {
    h.revoked.push([userId, id]);
    return Promise.resolve(true);
  },
}));
vi.mock("@/lib/auth/sign-in-redirect", () => ({
  redirectToSignIn: () => {
    h.redirects.push("/sign-in");
    throw new Redirect("/sign-in");
  },
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));

import { GET } from "@/app/(portal)/settings/reauth/complete/route";
import { reauthWithGoogleAction, reauthWithPasswordAction } from "@/app/(portal)/settings/reauth/actions";

const form = (f: Record<string, string>) => {
  const d = new FormData();
  for (const [k, v] of Object.entries(f)) d.set(k, v);
  return d;
};

beforeEach(() => {
  h.actor = { ok: true, userId: "u1" };
  h.verifyError = null;
  h.marked = true;
  h.current = "11111111-1111-4111-8111-111111111111";
  h.redirects = [];
  h.signIns = [];
  h.session = { user: { id: "u1" } };
  h.recent = { ok: true, sessionId: "33333333-3333-4333-8333-333333333333" };
  h.revoked = [];
});

describe("reauthWithPasswordAction", () => {
  it("marks this session as freshly signed in and goes back where it was asked", async () => {
    await expect(reauthWithPasswordAction(null, form({ password: "p", returnTo: "/settings/sessions" }))).rejects.toThrow(Redirect);
    expect(h.redirects).toEqual(["/settings/sessions"]);
  });

  it("never returns to another site", async () => {
    await expect(reauthWithPasswordAction(null, form({ password: "p", returnTo: "//evil.example" }))).rejects.toThrow(Redirect);
    expect(h.redirects).toEqual(["/settings"]);
  });

  it("shows the check's error and marks nothing", async () => {
    h.verifyError = "That password is incorrect.";
    expect(await reauthWithPasswordAction(null, form({ password: "p" }))).toEqual({ ok: false, error: "That password is incorrect." });
    expect(h.redirects).toEqual([]);
  });

  it("fails loud when there's no session row to mark", async () => {
    h.marked = false;
    expect(await reauthWithPasswordAction(null, form({ password: "p" }))).toMatchObject({ ok: false });
  });
});

describe("reauthWithGoogleAction", () => {
  it("asks Google to re-check (max_age=0) and carries the old session to clean up", async () => {
    await reauthWithGoogleAction(form({ returnTo: "/settings/sessions" }));
    const [provider, opts, params] = h.signIns[0] as [string, { redirectTo: string }, Record<string, string>];
    expect(provider).toBe("google");
    expect(params).toEqual({ max_age: "0" });
    const back = new URL(opts.redirectTo, "https://rmdig.ai");
    expect(back.pathname).toBe("/settings/reauth/complete");
    expect(back.searchParams.get("returnTo")).toBe("/settings/sessions");
    expect(back.searchParams.get("prev")).toBe(h.current);
  });

  it("sends a signed-out visitor to sign-in", async () => {
    h.actor = { ok: false, error: "x" };
    await expect(reauthWithGoogleAction(form({}))).rejects.toThrow(Redirect);
    expect(h.signIns).toEqual([]);
  });
});

describe("GET /settings/reauth/complete", () => {
  const req = (q: string) => ({ nextUrl: new URL(`https://rmdig.ai/settings/reauth/complete${q}`) }) as never;
  const prev = "11111111-1111-4111-8111-111111111111";

  it("ends the replaced session and returns to the page", async () => {
    const res = await GET(req(`?returnTo=%2Fsettings%2Fsessions&prev=${prev}`));
    expect(res.headers.get("location")).toBe("https://rmdig.ai/settings/sessions");
    expect(h.revoked).toEqual([["u1", prev]]);
  });

  it("sends back to the re-auth page when Google didn't give a fresh sign-in", async () => {
    h.recent = { ok: false, reauth: true };
    const res = await GET(req(`?prev=${prev}`));
    expect(res.headers.get("location")).toBe("https://rmdig.ai/settings/reauth?error=google");
    expect(h.revoked).toEqual([]);
  });

  it("never ends the current session, and ignores a malformed prev", async () => {
    await GET(req(`?prev=33333333-3333-4333-8333-333333333333`));
    await GET(req(`?prev=not-an-id`));
    expect(h.revoked).toEqual([]);
  });
});
