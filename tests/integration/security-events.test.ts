import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Migration 0028: the kind CHECK holds the closed list (lib/db/schema.ts
// ACCOUNT_SECURITY_EVENT_KINDS), and the rows go with the user (deletion).
//
// INTEGRATION_DATABASE_URL=postgresql://postgres:pw@127.0.0.1:55432/postgres pnpm test:integration

const url = process.env.INTEGRATION_DATABASE_URL;
if (!url) throw new Error("Set INTEGRATION_DATABASE_URL to a local PostGIS database.");
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") {
  throw new Error(`Refusing non-local INTEGRATION_DATABASE_URL host ${host}: integration tests never touch Neon.`);
}

const dbName = `secev_it_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const admin = postgres(url, { max: 1, onnotice: () => {} });
const testUrl = Object.assign(new URL(url), { pathname: `/${dbName}` }).toString();
let sql: postgres.Sql;
let userId: string;

beforeAll(async () => {
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  sql = postgres(testUrl, { max: 2, onnotice: () => {} });
  await migrate(drizzle(sql), { migrationsFolder: "lib/db/migrations" });
  const [user] = await sql<{ id: string }[]>`INSERT INTO users (email) VALUES ('e@example.com') RETURNING id`;
  userId = user!.id;
}, 60_000);

afterAll(async () => {
  await sql?.end();
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe("account_security_events (Postgres)", () => {
  it("accepts a listed kind with a default time", async () => {
    await sql`INSERT INTO account_security_events (user_id, kind) VALUES (${userId}, 'password_changed')`;
    const [row] = await sql<{ at: Date; session_id: string | null }[]>`SELECT at, session_id FROM account_security_events`;
    expect(row!.session_id).toBeNull();
    expect(Math.abs(new Date(row!.at).getTime() - Date.now())).toBeLessThan(60_000);
  });

  it("refuses a kind that isn't on the list", async () => {
    const code = await sql`INSERT INTO account_security_events (user_id, kind) VALUES (${userId}, 'something_else')`
      .then(() => undefined)
      .catch((err: { code?: string }) => err.code);
    expect(code).toBe("23514");
  });

  it("accepts the notice kinds added in 0030", async () => {
    await sql`INSERT INTO account_security_events (user_id, kind) VALUES (${userId}, 'notices_on'), (${userId}, 'notices_off')`;
    await sql`INSERT INTO security_notice_cursors (user_id, node, cursor) VALUES (${userId}, 'avserv-2', 'c1')`;
    await sql`UPDATE users SET security_notices_at = now() WHERE id = ${userId}`;
    const [row] = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM account_security_events WHERE kind LIKE 'notices_%'`;
    expect(row!.n).toBe("2");
  });

  it("keeps a session when its passkey is removed, forgetting which passkey (migration 0031)", async () => {
    const [pk] = await sql<{ id: string }[]>`
      INSERT INTO webauthn_credentials (user_id, credential_id, public_key, nickname) VALUES (${userId}, 'cred-1', 'AQID', 'My iPhone') RETURNING id`;
    await sql`INSERT INTO sessions ("sessionToken", "userId", expires, auth_method, auth_passkey_id)
              VALUES ('pk-session', ${userId}, now() + interval '1 day', 'passkey', ${pk!.id})`;
    await sql`INSERT INTO account_security_events (user_id, kind) VALUES (${userId}, 'passkey_added'), (${userId}, 'passkey_removed')`;
    await sql`DELETE FROM webauthn_credentials WHERE id = ${pk!.id}`;
    const [s] = await sql<{ auth_passkey_id: string | null; auth_method: string }[]>`SELECT auth_passkey_id, auth_method FROM sessions WHERE "sessionToken" = 'pk-session'`;
    expect(s).toEqual({ auth_passkey_id: null, auth_method: "passkey" });
    const dup = await sql`INSERT INTO webauthn_credentials (user_id, credential_id, public_key, nickname) VALUES (${userId}, 'cred-2', 'x', 'a'), (${userId}, 'cred-2', 'y', 'b')`
      .then(() => undefined)
      .catch((err: { code?: string }) => err.code);
    expect(dup).toBe("23505");
  });

  it("is deleted with the user, as their sessions and notice cursors are", async () => {
    await sql`INSERT INTO sessions ("sessionToken", "userId", expires) VALUES ('h', ${userId}, now() + interval '1 day')`;
    await sql`DELETE FROM users WHERE id = ${userId}`;
    const [ev] = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM account_security_events`;
    const [se] = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM sessions`;
    const [cu] = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM security_notice_cursors`;
    expect(ev!.n).toBe("0");
    expect(se!.n).toBe("0");
    expect(cu!.n).toBe("0");
  });
});
