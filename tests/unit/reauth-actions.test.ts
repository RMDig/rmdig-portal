import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  actor: { ok: true, userId: "u1" } as { ok: true; userId: string } | { ok: false; error: string },
  verifyError: null as string | null,
  marked: true,
  redirects: [] as string[],
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
vi.mock("@/lib/auth/portal-actor", () => ({ portalActor: () => Promise.resolve(h.actor) }));
vi.mock("@/lib/auth/reauth", () => ({ verifyPasswordReauth: () => Promise.resolve(h.verifyError) }));
vi.mock("@/lib/auth/recent-auth", () => ({ markRecentAuth: () => Promise.resolve(h.marked) }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));

import { reauthWithPasswordAction } from "@/app/(portal)/settings/reauth/actions";

const form = (f: Record<string, string>) => {
  const d = new FormData();
  for (const [k, v] of Object.entries(f)) d.set(k, v);
  return d;
};

beforeEach(() => {
  h.actor = { ok: true, userId: "u1" };
  h.verifyError = null;
  h.marked = true;
  h.redirects = [];
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

  it("refuses a signed-out caller", async () => {
    h.actor = { ok: false, error: "You must be signed in." };
    expect(await reauthWithPasswordAction(null, form({ password: "p" }))).toEqual({ ok: false, error: "You must be signed in." });
  });
});
