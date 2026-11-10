import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// portal_reader (scripts/sql/portal-reader-grants.sql): reads every portal
// table except credential material, writes nothing, and a re-run keeps it so.
//
// Runs every migration into a fresh, throwaway database on the local server,
// applies the grants file there, and connects as the role. Run:
// INTEGRATION_DATABASE_URL=postgresql://postgres:pw@127.0.0.1:55432/postgres pnpm test:integration

const url = process.env.INTEGRATION_DATABASE_URL;
if (!url) throw new Error("Set INTEGRATION_DATABASE_URL to a local PostGIS database.");
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") {
  throw new Error(`Refusing non-local INTEGRATION_DATABASE_URL host ${host}: integration tests never touch Neon.`);
}

const GRANTS = readFileSync("scripts/sql/portal-reader-grants.sql", "utf8");
const dbName = `reader_it_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const password = randomUUID();
const admin = postgres(url, { max: 1, onnotice: () => {} });
const testUrl = Object.assign(new URL(url), { pathname: `/${dbName}` }).toString();
const readerUrl = Object.assign(new URL(testUrl), { username: "portal_reader", password }).toString();
let owner: postgres.Sql;
let reader: postgres.Sql;

// The role is cluster-wide, so a run that crashed may have left it behind.
async function dropRole(): Promise<void> {
  const [r] = await admin`SELECT 1 FROM pg_roles WHERE rolname = 'portal_reader'`;
  if (r) await admin.unsafe(`DROP ROLE portal_reader`);
}

async function denied(query: string): Promise<string | undefined> {
  try {
    await reader.unsafe(query);
    return undefined;
  } catch (err) {
    return (err as { code?: string }).code;
  }
}

beforeAll(async () => {
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  owner = postgres(testUrl, { max: 1, onnotice: () => {} });
  await migrate(drizzle(owner), { migrationsFolder: "lib/db/migrations" });
  await owner`INSERT INTO users (email, password_hash, totp_secret_encrypted) VALUES ('a@example.com', 'bcrypt', 'sealed')`;
  await dropRole();
  await admin.unsafe(`CREATE ROLE portal_reader WITH LOGIN PASSWORD '${password}'`);
  await owner.unsafe(GRANTS).simple();
  await owner.unsafe(GRANTS).simple(); // idempotent: a re-run after a migration is the normal path
  reader = postgres(readerUrl, { max: 1, onnotice: () => {} });
}, 60_000);

afterAll(async () => {
  await reader?.end();
  await owner?.end();
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await dropRole();
  await admin.end();
});

describe("portal_reader grants (Postgres)", () => {
  it("reads portal tables, naming columns where a table holds credentials", async () => {
    expect(await reader`SELECT email FROM users`).toEqual([{ email: "a@example.com" }]);
    expect(await reader`SELECT count(*)::int AS n FROM sar_orgs`).toEqual([{ n: 0 }]);
    expect(await reader`SELECT count(*)::int AS n FROM sar_org_terms`).toEqual([{ n: 0 }]);
    expect((await reader`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`)[0]?.n).toBeGreaterThan(0);
    expect(await reader`SELECT "userId" FROM sessions`).toEqual([]);
  });

  it("can't read any credential column", async () => {
    for (const q of [
      "SELECT password_hash FROM users",
      "SELECT totp_secret_encrypted FROM users",
      "SELECT * FROM users",
      'SELECT "sessionToken" FROM sessions',
      "SELECT code_hash FROM mfa_recovery_codes",
      "SELECT token FROM verification_tokens",
      "SELECT token_hash FROM password_reset_tokens",
      "SELECT token_hash FROM org_invitations",
      "SELECT token_hash FROM deletion_requests",
      "SELECT access_token, refresh_token, id_token FROM accounts",
    ]) {
      expect(await denied(q), q).toBe("42501");
    }
  });

  it("writes nothing, even after turning read-only off for its session", async () => {
    expect(await denied("INSERT INTO users (email) VALUES ('b@example.com')")).toBe("25006");
    await reader`SET default_transaction_read_only = off`;
    expect(await denied("INSERT INTO users (email) VALUES ('b@example.com')")).toBe("42501");
    expect(await denied("UPDATE sar_orgs SET name = 'x'")).toBe("42501");
    expect(await denied("DELETE FROM users")).toBe("42501");
    expect(await denied("CREATE TABLE public.t (x int)")).toBe("42501");
  });
});
