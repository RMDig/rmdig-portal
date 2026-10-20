import postgres from "postgres";

import { decryptWith, encryptWith, parseMfaKeys, secretKid } from "../lib/auth/mfa-keys";
import { tlsFor } from "../lib/db/tls";

// Move every stored TOTP secret onto the current MFA key (plan 36 H3; runbook
// "Rotating the MFA encryption key"). Dry run unless --apply. Prints counts
// only: never a secret, an email or a user id. Reads process.env directly,
// like check-service-key.ts: lib/env would validate unrelated variables.
//
//   DATABASE_URL=... MFA_ENCRYPTION_KEYS=... MFA_ENCRYPTION_KEY=... pnpm mfa:reencrypt [--apply]

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const set = parseMfaKeys(process.env.MFA_ENCRYPTION_KEYS, process.env.MFA_ENCRYPTION_KEY);
  const sql = postgres(url, { ssl: tlsFor(url), max: 1, prepare: false });
  try {
    const rows = await sql<{ id: string; secret: string }[]>`
      SELECT id, totp_secret_encrypted AS secret FROM users WHERE totp_secret_encrypted IS NOT NULL`;
    const byKid = new Map<string, number>();
    let moved = 0;
    for (const row of rows) {
      const kid = secretKid(row.secret);
      byKid.set(kid, (byKid.get(kid) ?? 0) + 1);
      if (kid === set.current) continue;
      // Decrypting first proves the old key is right before anything is written.
      const next = encryptWith(set, decryptWith(set, row.secret));
      if (apply) {
        // Only if unchanged since it was read, so a concurrent enrollment wins.
        const r = await sql`UPDATE users SET totp_secret_encrypted = ${next} WHERE id = ${row.id} AND totp_secret_encrypted = ${row.secret}`;
        moved += r.count;
      } else {
        moved++;
      }
    }
    const summary = [...byKid].map(([k, n]) => `${k}: ${n}`).join(", ") || "none";
    console.log(`mfa-reencrypt: ${rows.length} secrets (${summary}); current key ${set.current}.`);
    console.log(apply ? `mfa-reencrypt: moved ${moved} to ${set.current}.` : `mfa-reencrypt: dry run, would move ${moved}. Run with --apply.`);
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error(`mfa-reencrypt: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
