// The production-migration guard (CLAUDE.md §3.8, docs/runbook.md "Migration
// guard"): compares the migrations a branch ships with the ones production has
// applied, so a PR cannot merge (and auto-deploy) ahead of its schema.
//
// Drizzle records each applied migration in drizzle.__drizzle_migrations with
// created_at = the journal entry's `when`, and `drizzle-kit migrate` only
// applies entries NEWER than the latest applied one. Two failure modes follow:
//  - pending:     not applied yet; run `pnpm db:migrate` against production.
//  - unreachable: not applied, but older than production's latest, so
//                 `db:migrate` will skip it silently forever (typical when two
//                 migration branches cross); it must be regenerated.
// Pure, so every case is unit-tested; scripts/check-prod-migrations.ts feeds it.

export interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

export interface GuardResult {
  outcome: "pass" | "fail";
  pending: string[];
  unreachable: string[];
  /** Applied in production but unknown to this branch (e.g. another open PR's
   *  migration was applied first). Informational: not a failure. */
  unknownApplied: number[];
  messages: GuardMessage[];
}

export interface GuardMessage {
  level: "error" | "warning" | "info";
  text: string;
}

export function evaluateMigrations(journal: JournalEntry[], appliedCreatedAt: number[]): GuardResult {
  const applied = new Set(appliedCreatedAt);
  const latest = appliedCreatedAt.length > 0 ? Math.max(...appliedCreatedAt) : -Infinity;
  const known = new Set(journal.map((e) => e.when));

  const notApplied = journal.filter((e) => !applied.has(e.when)).sort((a, b) => a.when - b.when);
  const unreachable = notApplied.filter((e) => e.when <= latest).map((e) => e.tag);
  const pending = notApplied.filter((e) => e.when > latest).map((e) => e.tag);
  const unknownApplied = appliedCreatedAt.filter((t) => !known.has(t)).sort((a, b) => a - b);

  const messages: GuardMessage[] = [];
  if (pending.length > 0) {
    messages.push({
      level: "error",
      text:
        `Not yet applied to production: ${pending.join(", ")}. ` +
        "Apply it before merging (runbook: Run a production migration), then re-run this check.",
    });
  }
  if (unreachable.length > 0) {
    messages.push({
      level: "error",
      text:
        `Not applied, and older than production's latest migration: ${unreachable.join(", ")}. ` +
        "`db:migrate` would skip it silently. Regenerate it on top of main (pnpm db:generate).",
    });
  }
  if (unknownApplied.length > 0) {
    messages.push({
      level: "warning",
      text:
        `Production has ${unknownApplied.length} migration(s) this branch doesn't know ` +
        `(created_at ${unknownApplied.join(", ")}). Usually another PR's migration, applied first: rebase onto main.`,
    });
  }
  const outcome = pending.length > 0 || unreachable.length > 0 ? "fail" : "pass";
  if (outcome === "pass") {
    messages.unshift({
      level: "info",
      text: `All ${journal.length} migrations on this branch are applied to production.`,
    });
  }
  return { outcome, pending, unreachable, unknownApplied, messages };
}
