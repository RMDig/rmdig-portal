import type { Adapter, AdapterSession, AdapterUser } from "next-auth/adapters";
import { describe, expect, it } from "vitest";

import { hashSessionToken, withHashedSessions } from "@/lib/auth/session-adapter";

// The wrapper against an in-memory base adapter: what's stored is the hash, what
// Auth.js gets back is the raw token it set in the cookie.

type Row = AdapterSession & Record<string, unknown>;
const user = { id: "u1", email: "a@example.com", emailVerified: null } as AdapterUser;

function baseAdapter() {
  const rows = new Map<string, Row>();
  const base: Adapter = {
    createSession: (s) => {
      const row = { ...s } as Row;
      rows.set(row.sessionToken, row);
      return Promise.resolve(row);
    },
    getSessionAndUser: (token) => {
      const row = rows.get(token);
      return Promise.resolve(row ? { session: row, user } : null);
    },
    updateSession: (s) => {
      const row = rows.get(s.sessionToken);
      if (!row) return Promise.resolve(null);
      Object.assign(row, s);
      return Promise.resolve(row);
    },
    deleteSession: (token) => {
      rows.delete(token);
      return Promise.resolve();
    },
  };
  return { base, rows };
}

const RAW = "6f8c2a8e-7b4d-4f0a-9a3e-2d1c0b9a8f7e";
const expires = new Date("2026-11-17T00:00:00Z");

function wrapped(userAgent: string | null = "Mozilla/5.0 (iPhone) Safari") {
  const { base, rows } = baseAdapter();
  const now = new Date("2026-10-18T12:00:00Z");
  const adapter = withHashedSessions(base, { userAgent: () => Promise.resolve(userAgent), now: () => now });
  return { adapter, rows, now };
}

describe("withHashedSessions", () => {
  it("stores sha256 of the token, never the token, and returns the raw token for the cookie", async () => {
    const { adapter, rows } = wrapped();
    const created = await adapter.createSession!({ sessionToken: RAW, userId: "u1", expires });
    expect(created.sessionToken).toBe(RAW);
    expect([...rows.keys()]).toEqual([hashSessionToken(RAW)]);
    expect(hashSessionToken(RAW)).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify([...rows.values()])).not.toContain(RAW);
  });

  it("records the sign-in method: password when the credentials sign-in says so, oauth otherwise", async () => {
    const { adapter, rows } = wrapped();
    await adapter.createSession!({ sessionToken: RAW, userId: "u1", expires, authMethod: "password" } as never);
    await adapter.createSession!({ sessionToken: "oauth-token", userId: "u1", expires });
    expect(rows.get(hashSessionToken(RAW))?.authMethod).toBe("password");
    expect(rows.get(hashSessionToken("oauth-token"))?.authMethod).toBe("oauth");
  });

  it("records the browser's user agent, cut to 200 characters", async () => {
    const { adapter, rows } = wrapped("x".repeat(500));
    await adapter.createSession!({ sessionToken: RAW, userId: "u1", expires });
    expect(rows.get(hashSessionToken(RAW))?.userAgent).toBe("x".repeat(200));
  });

  it("stores a null user agent when the browser sent none", async () => {
    const { adapter, rows } = wrapped(null);
    await adapter.createSession!({ sessionToken: RAW, userId: "u1", expires });
    expect(rows.get(hashSessionToken(RAW))?.userAgent).toBeNull();
  });

  it("finds a session by the raw cookie token and hands the raw token back", async () => {
    const { adapter } = wrapped();
    await adapter.createSession!({ sessionToken: RAW, userId: "u1", expires });
    const found = await adapter.getSessionAndUser!(RAW);
    expect(found?.user.id).toBe("u1");
    expect(found?.session.sessionToken).toBe(RAW);
  });

  it("finds nothing for a token whose hash was stored instead (no double lookups)", async () => {
    const { adapter } = wrapped();
    await adapter.createSession!({ sessionToken: RAW, userId: "u1", expires });
    expect(await adapter.getSessionAndUser!(hashSessionToken(RAW))).toBeNull();
    expect(await adapter.getSessionAndUser!("some-other-token")).toBeNull();
  });

  it("extends by the raw token, stamps last_seen_at, and survives Auth.js's get-then-update round trip", async () => {
    const { adapter, rows, now } = wrapped();
    await adapter.createSession!({ sessionToken: RAW, userId: "u1", expires });
    const found = await adapter.getSessionAndUser!(RAW);
    const later = new Date("2026-12-01T00:00:00Z");
    const updated = await adapter.updateSession!({ ...found!.session, expires: later });
    expect(updated?.sessionToken).toBe(RAW);
    const row = rows.get(hashSessionToken(RAW));
    expect(row?.expires).toEqual(later);
    expect(row?.lastSeenAt).toEqual(now);
    expect(rows.size).toBe(1);
  });

  it("deletes by the raw cookie token", async () => {
    const { adapter, rows } = wrapped();
    await adapter.createSession!({ sessionToken: RAW, userId: "u1", expires });
    await adapter.deleteSession!(RAW);
    expect(rows.size).toBe(0);
  });

  it("refuses a base adapter without session methods", () => {
    expect(() => withHashedSessions({}, { userAgent: () => Promise.resolve(null) })).toThrow(/session method/);
  });
});
