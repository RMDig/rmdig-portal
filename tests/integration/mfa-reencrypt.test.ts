import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { decryptWith, encryptWith, parseMfaKeys, secretKid } from "@/lib/auth/mfa-keys";

// scripts/mfa-reencrypt.ts against a real database (plan 36 H3): a dry run
// changes nothing, --apply moves every secret to the current key, and each
// still decrypts to the same TOTP secret.
//
// INTEGRATION_DATABASE_URL=postgresql://postgres:pw@127.0.0.1:55432/postgres pnpm test:integration

const url = process.env.INTEGRATION_DATABASE_URL;
if (!url) throw new Error("Set INTEGRATION_DATABASE_URL to a local PostGIS database.");
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") {
  throw new Error(`Refusing non-local INTEGRATION_DATABASE_URL host ${host}: integration tests never touch Neon.`);
}

const dbName = `mfa_it_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const admin = postgres(url, { max: 1, onnotice: () => {} });
const testUrl = Object.assign(new URL(url), { pathname: `/${dbName}` }).toString();
let sql: postgres.Sql;

const k1 = randomBytes(32).toString("hex");
const k2 = randomBytes(32).toString("hex");
const before = parseMfaKeys(undefined, k1);
const after = parseMfaKeys(`k2:${k2}`, k1);

function run(...args: string[]): string {
  return execFileSync("pnpm", ["exec", "tsx", "scripts/mfa-reencrypt.ts", ...args], {
    env: { ...process.env, DATABASE_URL: testUrl, MFA_ENCRYPTION_KEY: k1, MFA_ENCRYPTION_KEYS: `k2:${k2}` },
    encoding: "utf8",
  });
}

beforeAll(async () => {
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  sql = postgres(testUrl, { max: 2, onnotice: () => {} });
  await migrate(drizzle(sql), { migrationsFolder: "lib/db/migrations" });
  const legacy = encryptWith(before, "LEGACYSECRET234").split(":").slice(2).join(":");
  await sql`INSERT INTO users (email, totp_secret_encrypted) VALUES
    ('a@example.org', ${legacy}),
    ('b@example.org', ${encryptWith(before, "SECONDSECRET567")}),
    ('c@example.org', ${encryptWith(after, "ALREADYNEW23456")}),
    ('d@example.org', NULL)`;
}, 60_000);

afterAll(async () => {
  await sql?.end();
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe("mfa-reencrypt (Postgres)", () => {
  it("dry run counts what would move and changes nothing", async () => {
    const before = await sql`SELECT totp_secret_encrypted FROM users ORDER BY email`;
    const out = run();
    expect(out).toMatch(/3 secrets \(k1: 2, k2: 1\); current key k2/);
    expect(out).toMatch(/dry run, would move 2/);
    expect(await sql`SELECT totp_secret_encrypted FROM users ORDER BY email`).toEqual(before);
  }, 60_000);

  it("--apply moves every secret to k2, each still the same secret, and prints no secret", async () => {
    const out = run("--apply");
    expect(out).toMatch(/moved 2 to k2/);
    expect(out).not.toMatch(/SECRET|example\.org/);
    const rows = await sql<{ email: string; s: string | null }[]>`SELECT email, totp_secret_encrypted AS s FROM users ORDER BY email`;
    const plain = rows.map((r) => (r.s ? [secretKid(r.s), decryptWith(after, r.s)] : null));
    expect(plain).toEqual([["k2", "LEGACYSECRET234"], ["k2", "SECONDSECRET567"], ["k2", "ALREADYNEW23456"], null]);
    expect(run()).toMatch(/would move 0/);
  }, 60_000);

  it("adds totp_last_step (migration 0034), empty for everyone", async () => {
    const [r] = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM users WHERE totp_last_step IS NOT NULL`;
    expect(r!.n).toBe("0");
  });
});
