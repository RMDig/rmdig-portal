import { randomUUID } from "node:crypto";

import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hashSessionToken, withHashedSessions } from "@/lib/auth/session-adapter";
import { accounts, sessions, users, verificationTokens } from "@/lib/db/schema";

// The hashed-session wrapper on the real Drizzle adapter and migration 0027: the
// unit test covers the logic, this proves the adapter writes the extra columns
// the wrapper passes (user agent, last seen) and the defaults fill the rest.
//
// INTEGRATION_DATABASE_URL=postgresql://postgres:pw@127.0.0.1:55432/postgres pnpm test:integration

const url = process.env.INTEGRATION_DATABASE_URL;
if (!url) throw new Error("Set INTEGRATION_DATABASE_URL to a local PostGIS database.");
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") {
  throw new Error(`Refusing non-local INTEGRATION_DATABASE_URL host ${host}: integration tests never touch Neon.`);
}

const dbName = `sess_it_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const admin = postgres(url, { max: 1, onnotice: () => {} });
const testUrl = Object.assign(new URL(url), { pathname: `/${dbName}` }).toString();
let sql: postgres.Sql;
let userId: string;
let adapter: ReturnType<typeof withHashedSessions>;
const seen = new Date("2026-10-18T12:00:00Z");

beforeAll(async () => {
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  sql = postgres(testUrl, { max: 2, onnotice: () => {} });
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder: "lib/db/migrations" });
  const [user] = await sql<{ id: string }[]>`INSERT INTO users (email) VALUES ('s@example.com') RETURNING id`;
  userId = user!.id;
  adapter = withHashedSessions(
    DrizzleAdapter(db, { usersTable: users, accountsTable: accounts, sessionsTable: sessions, verificationTokensTable: verificationTokens }),
    { userAgent: () => Promise.resolve("Mozilla/5.0 (iPhone) Safari"), now: () => seen },
  );
}, 60_000);

afterAll(async () => {
  await sql?.end();
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe("hashed sessions (Postgres)", () => {
  const raw = randomUUID();

  it("stores the hash with a user agent, a session id and auth_time, and returns the raw token", async () => {
    const created = await adapter.createSession!({ sessionToken: raw, userId, expires: new Date(Date.now() + 86_400_000) });
    expect(created.sessionToken).toBe(raw);
    const [row] = await sql<{ sessionToken: string; id: string; user_agent: string; auth_time: Date; created_at: Date; last_seen_at: Date | null }[]>`
      SELECT "sessionToken", id, user_agent, auth_time, created_at, last_seen_at FROM sessions`;
    expect(row!.sessionToken).toBe(hashSessionToken(raw));
    expect(row!.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row!.user_agent).toBe("Mozilla/5.0 (iPhone) Safari");
    expect(Math.abs(new Date(row!.auth_time).getTime() - Date.now())).toBeLessThan(60_000);
    expect(row!.last_seen_at).toBeNull();
  });

  it("finds the session by the raw token and extends it with last_seen_at", async () => {
    const found = await adapter.getSessionAndUser!(raw);
    expect(found?.user.id).toBe(userId);
    const later = new Date(Date.now() + 2 * 86_400_000);
    const updated = await adapter.updateSession!({ ...found!.session, expires: later });
    expect(updated?.sessionToken).toBe(raw);
    const [row] = await sql<{ expires: Date; last_seen_at: Date }[]>`SELECT expires, last_seen_at FROM sessions`;
    expect(new Date(row!.expires).getTime()).toBe(later.getTime());
    expect(new Date(row!.last_seen_at).getTime()).toBe(seen.getTime());
  });

  it("records how each session signed in, and refuses an unknown method (migration 0029)", async () => {
    const pw = randomUUID();
    const google = randomUUID();
    await adapter.createSession!({ sessionToken: pw, userId, expires: new Date(Date.now() + 86_400_000), authMethod: "password" } as never);
    await adapter.createSession!({ sessionToken: google, userId, expires: new Date(Date.now() + 86_400_000) });
    const rows = await sql<{ sessionToken: string; auth_method: string }[]>`SELECT "sessionToken", auth_method FROM sessions`;
    const method = (t: string) => rows.find((r) => r.sessionToken === hashSessionToken(t))?.auth_method;
    expect(method(pw)).toBe("password");
    expect(method(google)).toBe("oauth");
    const code = await sql`UPDATE sessions SET auth_method = 'magic' WHERE "sessionToken" = ${hashSessionToken(pw)}`
      .then(() => undefined)
      .catch((err: { code?: string }) => err.code);
    expect(code).toBe("23514");
    await sql`DELETE FROM sessions WHERE "sessionToken" IN (${hashSessionToken(pw)}, ${hashSessionToken(google)})`;
  });

  it("deletes by the raw token", async () => {
    await adapter.deleteSession!(raw);
    const [row] = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM sessions`;
    expect(row!.count).toBe("0");
  });
});
