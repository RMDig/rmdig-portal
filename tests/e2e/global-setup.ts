import { loadEnvConfig } from "@next/env";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { E2E_USER } from "./helpers";
import { users } from "../../lib/db/schema";

// Seed the verified, non-staff credentials user the device-link suites log in
// as. Resets avserv_account_id to NULL each run so the test can assert the
// signIn-event map populates it from scratch.
//
// Loads env like drizzle.config.ts (loadEnvConfig — drizzle-kit/scripts don't
// auto-read .env.local). DATABASE_URL must be a disposable dev/test branch.

loadEnvConfig(process.cwd());

// This setup WRITES to the users table, so it must never touch production. Neon
// branch hostnames are opaque (ep-<random>-pooler...), so a URL substring check
// can't reliably tell dev from prod — it would both miss real dev branches and
// give false confidence. Instead require a positive, explicit acknowledgement:
// the operator/CI sets E2E_ALLOW_DB=1 to affirm DATABASE_URL is disposable.
function requireDisposableDbOptIn(): void {
  if (process.env.E2E_ALLOW_DB !== "1") {
    throw new Error(
      "E2E global-setup seeds and mutates the users table, so it refuses to run unless you " +
        "confirm the target DB is disposable. Point DATABASE_URL at a throwaway Neon dev/test " +
        "branch and set E2E_ALLOW_DB=1. NEVER set it against production.",
    );
  }
}

export default async function globalSetup(): Promise<void> {
  requireDisposableDbOptIn();

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "E2E global-setup: DATABASE_URL is not set — point it at a disposable Neon dev branch.",
    );
  }

  const client = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(client, { schema: { users } });
  try {
    const passwordHash = await bcrypt.hash(E2E_USER.password, 10);
    const now = new Date();
    await db
      .insert(users)
      .values({
        email: E2E_USER.email,
        passwordHash,
        emailVerified: now,
        displayName: E2E_USER.displayName,
      })
      .onConflictDoUpdate({
        target: users.email,
        // Re-seed deterministically: refresh the credential, keep the email
        // verified, and clear any prior mapping so the map assertion is honest.
        set: { passwordHash, emailVerified: now, avservAccountId: null },
      });

    // Belt-and-suspenders: ensure the mapping really is null even if the row
    // pre-existed via a path that skipped the conflict set above.
    await db
      .update(users)
      .set({ avservAccountId: null })
      .where(eq(users.email, E2E_USER.email));
  } finally {
    await client.end();
  }
}
