import { sql } from "drizzle-orm";

import { db } from "./db";

export interface RateLimitResult {
  allowed: boolean;
  attempts: number;
  resetAt: Date;
}

// Single-statement atomic upsert. On each call: if the row's window has already
// expired, reset to attempts=1 with a fresh window. Otherwise increment. Bounds
// the request to one round-trip and avoids the classic check-then-increment race.
//
// `key` should be specific enough to throttle the right thing — e.g.,
// `signin:<email>` for credentials sign-in attempts. windowSec is the rolling
// window length; `limit` is the inclusive cap (attempts <= limit means allowed).
export async function incrementRateLimit(
  key: string,
  options: { limit: number; windowSec: number },
): Promise<RateLimitResult> {
  const { limit, windowSec } = options;

  const rows = (await db.execute(sql`
    INSERT INTO rate_limits (key, attempts, window_start)
    VALUES (${key}, 1, now())
    ON CONFLICT (key) DO UPDATE
    SET
      attempts = CASE
        WHEN rate_limits.window_start < now() - (${windowSec}::int * INTERVAL '1 second')
          THEN 1
        ELSE rate_limits.attempts + 1
      END,
      window_start = CASE
        WHEN rate_limits.window_start < now() - (${windowSec}::int * INTERVAL '1 second')
          THEN now()
        ELSE rate_limits.window_start
      END
    RETURNING attempts, window_start
  `)) as unknown as Array<{ attempts: number; window_start: string | Date }>;

  const row = rows[0];
  if (!row) {
    throw new Error("rate-limit upsert returned no rows");
  }
  const windowStart =
    row.window_start instanceof Date ? row.window_start : new Date(row.window_start);
  const resetAt = new Date(windowStart.getTime() + windowSec * 1000);

  return {
    allowed: row.attempts <= limit,
    attempts: row.attempts,
    resetAt,
  };
}

// Clear a rate-limit row — used after a successful sign-in so a future failed
// attempt starts the window over rather than inheriting prior failures.
export async function resetRateLimit(key: string): Promise<void> {
  await db.execute(sql`DELETE FROM rate_limits WHERE key = ${key}`);
}
