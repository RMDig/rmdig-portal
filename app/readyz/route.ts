import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import journal from "@/lib/db/migrations/meta/_journal.json";
import { env } from "@/lib/env";
import { evaluateReadiness } from "@/lib/health/readiness";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Readiness for the external uptime probe (lib/health/readiness.ts explains
// why /healthz isn't enough). 503 when the database can't be read or lacks a
// migration this build ships; the cause goes to the log, never the body.
const QUERY_TIMEOUT_MS = 8000;

async function appliedMigrations(): Promise<number[] | Error> {
  try {
    const rows = await Promise.race([
      db.execute<{ created_at: string | number }>(
        sql`SELECT created_at FROM drizzle.__drizzle_migrations`,
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`readyz query timed out after ${QUERY_TIMEOUT_MS} ms`)), QUERY_TIMEOUT_MS),
      ),
    ]);
    return Array.from(rows, (r) => Number(r.created_at));
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error({ event: "readyz.database_unreadable", err: error });
    return error;
  }
}

export async function GET() {
  const readiness = evaluateReadiness(journal.entries, await appliedMigrations());
  if (readiness.status === "unready" && readiness.checks.schema === "behind") {
    logger.error({ event: "readyz.schema_behind" });
  }
  const commit = env.VERCEL_GIT_COMMIT_SHA || env.GIT_COMMIT_SHA || "unknown";
  return NextResponse.json(
    { ...readiness, commit },
    { status: readiness.status === "ready" ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
