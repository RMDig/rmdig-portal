import { loadEnvConfig } from "@next/env";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import { userPlatformRoles, users } from "../lib/db/schema";

// Promote a user to rmdig_admin by email. Idempotent — re-running is a no-op.
// Seeding lives in a script, not a migration: it's environment-specific data,
// and migrations must stay deterministic + replayable across every database.
//
//   pnpm db:seed-admin you@example.com
//
// Loads env the same way drizzle.config.ts does, so it sees the same DATABASE_URL.
loadEnvConfig(process.cwd());

async function main() {
  const email = process.argv[2]?.toLowerCase();
  if (!email) {
    console.error("Usage: pnpm db:seed-admin <email>");
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set (check .env.local).");
    process.exit(1);
  }

  const client = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(client, { schema: { users, userPlatformRoles } });

  try {
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) {
      console.error(`No user found for ${email}. Sign up first, then re-run.`);
      process.exit(1);
    }

    await db
      .insert(userPlatformRoles)
      .values({ userId: user.id, role: "rmdig_admin" })
      .onConflictDoNothing();

    console.log(`✓ ${email} is now rmdig_admin.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
