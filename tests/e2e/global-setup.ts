import { loadEnvConfig } from "@next/env";
import bcrypt from "bcryptjs";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { E2E_PERSONAS } from "./helpers";
import { userPlatformRoles, users } from "../../lib/db/schema";

// Seed the E2E role personas (helpers.E2E_PERSONAS): the default member the
// device-link/SAR-create suites log in as, plus a staff (rmdig_admin + rmdig_sar_approver) reviewer
// and a second invitee user. Each is upserted verified with avserv_account_id
// reset to NULL, so the device-link map-on-login assertion starts from scratch;
// the staff persona also gets its platform-role row.
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
  const db = drizzle(client, { schema: { users, userPlatformRoles } });
  try {
    const now = new Date();
    for (const { user, platformRoles } of E2E_PERSONAS) {
      const passwordHash = await bcrypt.hash(user.password, 10);
      const [row] = await db
        .insert(users)
        .values({
          email: user.email,
          passwordHash,
          emailVerified: now,
          displayName: user.displayName,
        })
        .onConflictDoUpdate({
          target: users.email,
          // Re-seed deterministically: refresh the credential, keep the email
          // verified, and clear any prior AvServ mapping so the map-on-login
          // assertion is honest. returning() gives the id either way (insert or
          // update) for the role grant below.
          set: { passwordHash, emailVerified: now, avservAccountId: null },
        })
        .returning({ id: users.id });

      // Grant the platform role for staff personas. Idempotent on the
      // (user_id, role) PK so re-runs don't duplicate.
      for (const role of row ? platformRoles : []) {
        await db.insert(userPlatformRoles).values({ userId: row!.id, role }).onConflictDoNothing();
      }
    }
  } finally {
    await client.end();
  }
}
