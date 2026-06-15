import { loadEnvConfig } from "@next/env";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { mfaRecoveryCodes, users } from "../lib/db/schema";

// Reset a user's MFA by email — clears the TOTP secret + enrollment and drops
// their recovery codes, exactly like the self-service "disable MFA" path. For
// when a user has lost BOTH their authenticator and their recovery codes.
//
//   pnpm db:reset-mfa user@example.com
//
// VERIFY THE USER'S IDENTITY OUT OF BAND FIRST — this removes their second
// factor. They re-enroll at /settings/mfa/enroll on next sign-in.
//
// Loads env the same way drizzle.config.ts does, so it sees the same DATABASE_URL.
loadEnvConfig(process.cwd());

async function main() {
  const email = process.argv[2]?.toLowerCase();
  if (!email) {
    console.error("Usage: pnpm db:reset-mfa <email>");
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set (check .env.local).");
    process.exit(1);
  }

  const client = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(client, { schema: { users, mfaRecoveryCodes } });

  try {
    const [user] = await db
      .select({ id: users.id, enabledAt: users.mfaEnabledAt })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) {
      console.error(`No user found for ${email}.`);
      process.exit(1);
    }

    await db
      .update(users)
      .set({ totpSecretEncrypted: null, mfaEnabledAt: null })
      .where(eq(users.id, user.id));
    await db.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, user.id));

    const was = user.enabledAt ? "had MFA enabled" : "had no active MFA";
    console.log(`✓ MFA reset for ${email} (${was}). They re-enroll at /settings/mfa/enroll.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
