import { evaluateMigrations, type JournalEntry } from "../db/migration-guard";

// What /readyz reports (docs/runbook.md "Outages and rollback"). /healthz
// proves only that the code is deployed; it never touches the database, so it
// stayed green through the 2026-10-01/02 DATABSE_URL outage (20 h) and the
// 2026-10-02 integration re-pin outage, when production pointed at a database
// without the schema. /readyz checks both: the database answers, and it holds
// every migration this build ships. An external probe pages the operator on
// any non-200.
//
// The body is public, so it names checks, never errors, hosts or row data.

export type CheckState = "ok" | "unreachable" | "behind" | "unknown";

export interface Readiness {
  status: "ready" | "unready";
  checks: { database: CheckState; schema: CheckState };
}

// Postgres undefined_table: the server answered, but the migrations table (so
// the whole schema) isn't there — a URL pointing at the wrong database.
const UNDEFINED_TABLE = "42P01";

function pgCode(err: unknown): string | undefined {
  // postgres-js puts `code` on the error; drizzle wraps it as `cause`.
  for (let e: unknown = err, depth = 0; e && depth < 3; depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

/** `applied` is the created_at list from drizzle.__drizzle_migrations, or the
 *  error raised while reading it (unreachable database, missing table). */
export function evaluateReadiness(journal: JournalEntry[], applied: number[] | Error): Readiness {
  if (applied instanceof Error) {
    if (pgCode(applied) === UNDEFINED_TABLE) {
      return { status: "unready", checks: { database: "ok", schema: "behind" } };
    }
    return { status: "unready", checks: { database: "unreachable", schema: "unknown" } };
  }
  // Applied-but-unknown entries (production migrated ahead of this deploy, as
  // CLAUDE.md §3.8 requires) are fine; only a missing migration is not.
  const schemaOk = evaluateMigrations(journal, applied).outcome === "pass";
  return {
    status: schemaOk ? "ready" : "unready",
    checks: { database: "ok", schema: schemaOk ? "ok" : "behind" },
  };
}
