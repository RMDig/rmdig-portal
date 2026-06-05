import { and, eq, isNull } from "drizzle-orm";

import { db } from "../db";
import { users } from "../db/schema";
import { logger } from "../logger";
import { findOrCreateAccount, isAvServConfigured } from "./client";

// Login-time account mapping (P-B1, rmdig-ai docs/plans/05 §"rmdig-portal side").
// On successful login, if the user has no avserv_account_id yet, find-or-create
// the canonical AvServ account for their verified email and persist the id.
//
// Hard rule from the contract: this NEVER blocks login. Any failure — AvServ
// down, bad service JWT, timeout — is logged and swallowed; the next login
// retries. It runs in the Auth.js `events.signIn` hook, which fires after the
// user row is persisted and whose result does not gate the session.

/**
 * Idempotently map a freshly-authenticated user to their AvServ account.
 * Self-contained and failure-safe: it reads the current mapping from the DB
 * (not a possibly-stale session object), skips if already mapped or
 * unconfigured, and never throws.
 */
export async function mapUserToAvServAccountOnLogin(userId: string): Promise<void> {
  if (!isAvServConfigured()) {
    // No AVSERV_BASE_URL yet (earliest local setup) — nothing to map against.
    return;
  }

  try {
    // Read the authoritative row rather than trusting the caller: confirms the
    // user still exists, the email is verified, and the mapping is genuinely
    // absent before we spend an AvServ round-trip.
    const [row] = await db
      .select({
        email: users.email,
        emailVerified: users.emailVerified,
        avservAccountId: users.avservAccountId,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!row) {
      logger.warn({ event: "avserv.map.user_missing", userId });
      return;
    }
    if (row.avservAccountId) {
      return; // already mapped — idempotent no-op
    }
    if (!row.emailVerified) {
      // The contract maps verified emails only. Credentials login already
      // enforces this; this guards the edge where it isn't yet set.
      logger.info({ event: "avserv.map.skip_unverified", userId });
      return;
    }

    const { accountId, created } = await findOrCreateAccount(row.email);

    // Guard the write with IS NULL so a concurrent login can't double-map or
    // clobber an id another request just set.
    const updated = await db
      .update(users)
      .set({ avservAccountId: accountId })
      .where(and(eq(users.id, userId), isNull(users.avservAccountId)))
      .returning({ id: users.id });

    if (updated.length > 0) {
      logger.info({ event: "avserv.map.linked", userId, created });
    }
  } catch (err) {
    // Transient by assumption — log and let the next login retry. Never rethrow.
    logger.error({ event: "avserv.map.failed", userId, err });
  }
}
