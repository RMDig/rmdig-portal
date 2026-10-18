import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fake: null as null | import("./helpers/fake-db").FakeDb,
  cookie: "tok-here" as string | null,
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
vi.mock("@/lib/auth/recent-auth", async () => {
  const { hashSessionToken } = await import("@/lib/auth/session-adapter");
  return { currentSessionTokenHash: () => Promise.resolve(h.cookie ? hashSessionToken(h.cookie) : null) };
});

import { hashSessionToken } from "@/lib/auth/session-adapter";
import {
  currentSessionId,
  listSessions,
  revokeOtherSessions,
  revokeSession,
  signOutOtherSessions,
} from "@/lib/auth/sessions";
import { createFakeDb } from "./helpers/fake-db";

const NOW = new Date("2026-10-18T12:00:00Z");
const day = 86_400_000;

function seed(id: string, userId: string, opts: { token?: string; createdAt: number; lastSeenAt?: number; expires?: number }) {
  h.fake!.rows("sessions").push({
    id,
    userId,
    sessionToken: hashSessionToken(opts.token ?? `tok-${id}`),
    createdAt: new Date(NOW.getTime() - opts.createdAt * day),
    lastSeenAt: opts.lastSeenAt === undefined ? null : new Date(NOW.getTime() - opts.lastSeenAt * day),
    userAgent: "ua",
    expires: new Date(NOW.getTime() + (opts.expires ?? 10) * day),
  });
}

beforeEach(() => {
  h.fake = createFakeDb();
  h.cookie = "tok-here";
  seed("here", "u1", { token: "tok-here", createdAt: 5 });
  seed("old", "u1", { createdAt: 20, lastSeenAt: 9 });
  seed("recent", "u1", { createdAt: 3, lastSeenAt: 1 });
  seed("expired", "u1", { createdAt: 40, expires: -1 });
  seed("theirs", "u2", { createdAt: 1 });
});

describe("sessions", () => {
  it("finds this browser's session by its cookie, only for its own user", async () => {
    expect(await currentSessionId("u1")).toBe("here");
    expect(await currentSessionId("u2")).toBeNull();
    h.cookie = null;
    expect(await currentSessionId("u1")).toBeNull();
  });

  it("lists live sessions, this browser first, then most recently active; never another user's", async () => {
    const list = await listSessions("u1", NOW);
    expect(list.map((s) => s.id)).toEqual(["here", "recent", "old"]);
    expect(list.map((s) => s.current)).toEqual([true, false, false]);
    expect(JSON.stringify(list)).not.toContain(hashSessionToken("tok-here"));
  });

  it("revokes one of the user's own sessions, and refuses another user's", async () => {
    expect(await revokeSession(h.fake!.db as never, "u1", "old")).toBe(true);
    expect(await revokeSession(h.fake!.db as never, "u1", "theirs")).toBe(false);
    expect(h.fake!.rows("sessions").map((r) => r.id).sort()).toEqual(["expired", "here", "recent", "theirs"]);
  });

  it("signs out everything but the kept session, leaving other users alone", async () => {
    expect(await revokeOtherSessions(h.fake!.db as never, "u1", "here")).toBe(3);
    expect(h.fake!.rows("sessions").map((r) => r.id).sort()).toEqual(["here", "theirs"]);
  });

  it("signs out all of the user's sessions when there is none to keep", async () => {
    expect(await signOutOtherSessions(h.fake!.db as never, "u1", null)).toBe(4);
    expect(h.fake!.rows("sessions").map((r) => r.id)).toEqual(["theirs"]);
  });
});
