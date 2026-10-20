import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "./db";

// Keys name what they throttle (`signin:<email>:<ip>`, `otp-phone:<E.164>`), so
// stored as given they'd keep a list of addresses, IPs and phone numbers in the
// table (plan 36 H6). The stored key keeps the readable prefix (to tell buckets
// apart) and hashes the rest. Exported for tests.
export function storedKey(key: string): string {
  const i = key.indexOf(":");
  const [prefix, rest] = i < 0 ? [key, ""] : [key.slice(0, i), key.slice(i + 1)];
  return rest ? `${prefix}:${createHash("sha256").update(rest).digest("hex").slice(0, 32)}` : prefix;
}

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
// `signup-ip:<ip>` for sign-ups per network. windowSec is the rolling
// window length; `limit` is the inclusive cap (attempts <= limit means allowed).
export async function incrementRateLimit(
  key: string,
  options: { limit: number; windowSec: number },
): Promise<RateLimitResult> {
  const { limit, windowSec } = options;

  const rows = (await db.execute(sql`
    INSERT INTO rate_limits (key, attempts, window_start)
    VALUES (${storedKey(key)}, 1, now())
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
  await db.execute(sql`DELETE FROM rate_limits WHERE key = ${storedKey(key)}`);
}

// Read a window without counting against it — for limits that only count
// failures (credentials sign-in's per-email cap): check here first, then
// incrementRateLimit only when the attempt fails. Unlike incrementRateLimit
// this is check-then-act, so concurrent requests can overshoot `limit` by the
// number in flight; only use it where an always-counting limit (e.g. per IP)
// bounds that concurrency. An expired window reads as zero attempts.
export async function peekRateLimit(
  key: string,
  options: { limit: number; windowSec: number },
): Promise<RateLimitResult> {
  const { limit, windowSec } = options;

  const rows = (await db.execute(sql`
    SELECT attempts, window_start FROM rate_limits
    WHERE key = ${storedKey(key)}
      AND window_start >= now() - (${windowSec}::int * INTERVAL '1 second')
  `)) as unknown as Array<{ attempts: number; window_start: string | Date }>;

  const row = rows[0];
  if (!row) {
    return { allowed: true, attempts: 0, resetAt: new Date(Date.now() + windowSec * 1000) };
  }
  const windowStart =
    row.window_start instanceof Date ? row.window_start : new Date(row.window_start);
  return {
    // Strictly below: the next failure would be attempt `attempts + 1`, and
    // incrementRateLimit allows attempts <= limit.
    allowed: row.attempts < limit,
    attempts: row.attempts,
    resetAt: new Date(windowStart.getTime() + windowSec * 1000),
  };
}
