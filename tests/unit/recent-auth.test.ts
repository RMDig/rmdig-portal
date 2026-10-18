import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fake: null as null | import("./helpers/fake-db").FakeDb,
  cookies: {} as Record<string, string>,
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("drizzle-orm", async () => (await import("./helpers/fake-db")).fakeOperators);
vi.mock("@/lib/db/schema", async () => {
  const { fakeTable } = await import("./helpers/fake-db");
  return { sessions: fakeTable("sessions") };
});
vi.mock("@/lib/db", () => ({
  get db() {
    return h.fake!.db;
  },
}));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({ get: (name: string) => (name in h.cookies ? { value: h.cookies[name] } : undefined) }),
}));

import {
  isRecentAuth,
  markRecentAuth,
  RECENT_AUTH_MAX_AGE_SEC,
  requireRecentAuth,
} from "@/lib/auth/recent-auth";
import { hashSessionToken } from "@/lib/auth/session-adapter";
import { createFakeDb } from "./helpers/fake-db";

const NOW = new Date("2026-10-18T12:00:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

function seed(token: string, userId: string, authTime: Date, id = "sess-1") {
  h.fake!.rows("sessions").push({ sessionToken: hashSessionToken(token), userId, authTime, id });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.fake = createFakeDb();
  h.cookies = {};
});

describe("isRecentAuth", () => {
  it("is 10 minutes by owner decision", () => {
    expect(RECENT_AUTH_MAX_AGE_SEC).toBe(600);
  });

  it("accepts up to the limit and refuses past it", () => {
    expect(isRecentAuth(minutesAgo(10), NOW)).toBe(true);
    expect(isRecentAuth(new Date(minutesAgo(10).getTime() - 1), NOW)).toBe(false);
  });

  it("tolerates the database clock a little ahead, not far ahead", () => {
    expect(isRecentAuth(new Date(NOW.getTime() + 30_000), NOW)).toBe(true);
    expect(isRecentAuth(new Date(NOW.getTime() + 5 * 60_000), NOW)).toBe(false);
  });
});

describe("requireRecentAuth", () => {
  it("passes a session that signed in 2 minutes ago, and names it", async () => {
    h.cookies["__Secure-authjs.session-token"] = "tok-a";
    seed("tok-a", "u1", minutesAgo(2));
    expect(await requireRecentAuth("u1", { now: NOW })).toEqual({ ok: true, sessionId: "sess-1" });
  });

  it("reads the unprefixed cookie on plain-http dev", async () => {
    h.cookies["authjs.session-token"] = "tok-a";
    seed("tok-a", "u1", minutesAgo(2));
    expect((await requireRecentAuth("u1", { now: NOW })).ok).toBe(true);
  });

  it("asks for re-authentication when the sign-in is older than 10 minutes", async () => {
    h.cookies["__Secure-authjs.session-token"] = "tok-a";
    seed("tok-a", "u1", minutesAgo(11));
    expect(await requireRecentAuth("u1", { now: NOW })).toEqual({ ok: false, reauth: true });
  });

  it("refuses another user's session, a missing row and a missing cookie", async () => {
    seed("tok-a", "u2", minutesAgo(1));
    h.cookies["__Secure-authjs.session-token"] = "tok-a";
    expect((await requireRecentAuth("u1", { now: NOW })).ok).toBe(false);
    h.cookies["__Secure-authjs.session-token"] = "tok-unknown";
    expect((await requireRecentAuth("u1", { now: NOW })).ok).toBe(false);
    h.cookies = {};
    expect((await requireRecentAuth("u1", { now: NOW })).ok).toBe(false);
    expect(h.log.warn).toHaveBeenCalledWith(expect.objectContaining({ event: "auth.recent.no_cookie" }));
  });
});

describe("markRecentAuth", () => {
  it("moves the current session's auth_time to now, and only that session", async () => {
    h.cookies["__Secure-authjs.session-token"] = "tok-a";
    seed("tok-a", "u1", minutesAgo(60), "sess-a");
    seed("tok-b", "u1", minutesAgo(60), "sess-b");
    expect(await markRecentAuth("u1")).toBe(true);
    const rows = h.fake!.rows("sessions");
    const a = rows.find((r) => r.id === "sess-a");
    const b = rows.find((r) => r.id === "sess-b");
    expect(isRecentAuth(a!.authTime as Date, new Date())).toBe(true);
    expect(b!.authTime).toEqual(minutesAgo(60));
  });

  it("reports false when there is no session to mark", async () => {
    expect(await markRecentAuth("u1")).toBe(false);
  });
});
