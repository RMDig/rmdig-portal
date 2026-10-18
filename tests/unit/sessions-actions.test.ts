import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  actor: { ok: true, userId: "u1" } as { ok: true; userId: string } | { ok: false; error: string },
  recent: { ok: true, sessionId: "11111111-1111-4111-8111-111111111111" } as
    | { ok: true; sessionId: string }
    | { ok: false; reauth: true },
  revokeOne: true,
  revokeOthers: 2,
  calls: [] as unknown[],
  events: [] as unknown[],
  revalidated: [] as string[],
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/auth/portal-actor", () => ({ portalActor: () => Promise.resolve(h.actor) }));
vi.mock("@/lib/auth/recent-auth", () => ({ requireRecentAuth: () => Promise.resolve(h.recent) }));
vi.mock("@/lib/auth/sessions", () => ({
  revokeSession: (_tx: unknown, userId: string, id: string) => {
    h.calls.push(["one", userId, id]);
    return Promise.resolve(h.revokeOne);
  },
  revokeOtherSessions: (_tx: unknown, userId: string, keep: string) => {
    h.calls.push(["others", userId, keep]);
    return Promise.resolve(h.revokeOthers);
  },
}));
vi.mock("@/lib/auth/security-events", () => ({
  recordSecurityEvent: (_tx: unknown, e: unknown) => {
    h.events.push(e);
    return Promise.resolve();
  },
}));
vi.mock("@/lib/db", () => ({ db: { transaction: <T>(fn: (tx: unknown) => Promise<T>) => fn({}) } }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => h.revalidated.push(p) }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));

import { revokeOtherSessionsAction, revokeSessionAction } from "@/app/(portal)/settings/sessions/actions";

const HERE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const fd = (sessionId?: string) => {
  const f = new FormData();
  if (sessionId) f.set("sessionId", sessionId);
  return f;
};

beforeEach(() => {
  h.actor = { ok: true, userId: "u1" };
  h.recent = { ok: true, sessionId: HERE };
  h.revokeOne = true;
  h.revokeOthers = 2;
  h.calls = [];
  h.events = [];
  h.revalidated = [];
});

describe("revokeSessionAction", () => {
  it("signs another browser out and records it", async () => {
    expect(await revokeSessionAction(null, fd(OTHER))).toEqual({ ok: true, message: "Signed out." });
    expect(h.calls).toEqual([["one", "u1", OTHER]]);
    expect(h.events).toEqual([{ userId: "u1", kind: "session_revoked", sessionId: HERE }]);
    expect(h.revalidated).toEqual(["/settings/sessions"]);
  });

  it("asks for a fresh sign-in first, and changes nothing until then", async () => {
    h.recent = { ok: false, reauth: true };
    expect(await revokeSessionAction(null, fd(OTHER))).toMatchObject({ ok: false, reauth: true });
    expect(h.calls).toEqual([]);
  });

  it("refuses when signed out, for a malformed id, and for this browser", async () => {
    h.actor = { ok: false, error: "You must be signed in." };
    expect(await revokeSessionAction(null, fd(OTHER))).toEqual({ ok: false, error: "You must be signed in." });
    h.actor = { ok: true, userId: "u1" };
    expect((await revokeSessionAction(null, fd("not-a-uuid")))?.ok).toBe(false);
    expect(await revokeSessionAction(null, fd(HERE))).toMatchObject({ ok: false, error: expect.stringMatching(/this browser/) });
    expect(h.calls).toEqual([]);
  });

  it("says so when the session had already ended, and records nothing", async () => {
    h.revokeOne = false;
    expect(await revokeSessionAction(null, fd(OTHER))).toMatchObject({ ok: false });
    expect(h.events).toEqual([]);
  });
});

describe("revokeOtherSessionsAction", () => {
  it("signs out everything but this browser and records it", async () => {
    expect(await revokeOtherSessionsAction(null, fd())).toEqual({ ok: true, message: "Signed out 2 other browsers." });
    expect(h.calls).toEqual([["others", "u1", HERE]]);
    expect(h.events).toEqual([{ userId: "u1", kind: "sessions_revoked_others", sessionId: HERE }]);
  });

  it("records nothing when there was nothing to sign out", async () => {
    h.revokeOthers = 0;
    expect(await revokeOtherSessionsAction(null, fd())).toEqual({ ok: true, message: "No other browsers were signed in." });
    expect(h.events).toEqual([]);
  });

  it("asks for a fresh sign-in first", async () => {
    h.recent = { ok: false, reauth: true };
    expect(await revokeOtherSessionsAction(null, fd())).toMatchObject({ ok: false, reauth: true });
    expect(h.calls).toEqual([]);
  });
});
