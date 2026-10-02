import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import postgres from "postgres";

import { evaluateMigrations, type JournalEntry } from "../lib/db/migration-guard";

// CI migration guard (docs/runbook.md "Migration guard"): fail a main-targeted
// PR whose migrations are not yet applied to production.
//
//   pnpm migrations:check-prod --base <sha>
//
// Reads production through PROD_MIGRATIONS_READ_URL, a role that can SELECT
// drizzle.__drizzle_migrations and nothing else. It never writes. Without that
// URL it fails only when the PR touches lib/db/migrations/; other PRs pass with
// a notice, so a missing secret can't block unrelated work silently or let a
// migration PR through.

const MIGRATIONS_DIR = join("lib", "db", "migrations");

function touchesMigrations(base: string): boolean {
  const out = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`, "--", MIGRATIONS_DIR], {
    encoding: "utf8",
  });
  return out.trim().length > 0;
}

function readJournal(): JournalEntry[] {
  const raw = readFileSync(join(process.cwd(), MIGRATIONS_DIR, "meta", "_journal.json"), "utf8");
  const parsed = JSON.parse(raw) as { entries: JournalEntry[] };
  return parsed.entries;
}

async function appliedInProduction(url: string): Promise<number[]> {
  const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 15, idle_timeout: 5 });
  try {
    const rows = await sql<{ created_at: string | number }[]>`
      SELECT created_at FROM drizzle.__drizzle_migrations
    `;
    return rows.map((r) => Number(r.created_at));
  } finally {
    await sql.end();
  }
}

async function main() {
  const i = process.argv.indexOf("--base");
  const base = i >= 0 ? process.argv[i + 1] : undefined;
  if (!base) {
    console.error("Usage: pnpm migrations:check-prod --base <sha>");
    process.exit(2);
  }

  const touched = touchesMigrations(base);
  const url = process.env.PROD_MIGRATIONS_READ_URL;
  if (!url) {
    if (touched) {
      console.log(
        "::error::This PR changes lib/db/migrations/ but PROD_MIGRATIONS_READ_URL is not set, so " +
          "the guard can't confirm production is migrated. Add the secret (runbook: Migration guard).",
      );
      process.exit(1);
    }
    console.log("::notice::PROD_MIGRATIONS_READ_URL is not set; this PR doesn't touch migrations, so skipping.");
    return;
  }

  const result = evaluateMigrations(readJournal(), await appliedInProduction(url));
  for (const m of result.messages) {
    // GitHub Actions annotations for errors and warnings; plain log otherwise.
    console.log(`${m.level === "info" ? "" : `::${m.level}::`}${m.text}`);
  }
  process.exit(result.outcome === "fail" ? 1 : 0);
}

main().catch((err) => {
  // A guard that can't reach production can't vouch for it: fail, never pass.
  // A refused connection is an AggregateError with an empty message; fall back
  // to its code so the log always says why. (Neither carries the password.)
  const e = err as Error & { code?: string };
  console.error("::error::migration guard could not check production:", e.message || e.code || String(err));
  process.exit(1);
});
