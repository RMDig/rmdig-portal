import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { previewMigrationUrl } from "../lib/preview-guard";

// Runs before `next build` on Vercel (package.json "vercel-build"). On a
// preview it brings the preview database (a separate Neon project) up to the
// branch's migrations, so a PR that adds a migration is testable on its
// preview. Every
// other environment is a no-op: production is migrated by hand before merge
// (CLAUDE.md §3.8), never by a build. previewMigrationUrl refuses the
// production endpoint, so a misrouted preview fails the build instead.
async function main() {
  const url = previewMigrationUrl({
    VERCEL_ENV: process.env.VERCEL_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
  });
  if (!url) {
    console.log("migrate-preview: not a preview build, skipping.");
    return;
  }

  const client = postgres(url, { prepare: false, max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder: "./lib/db/migrations" });
    console.log("migrate-preview: preview database is up to date.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("migrate-preview failed:", err);
  process.exit(1);
});
