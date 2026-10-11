import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { deletionRequests } from "../db/schema";
import { hashDeletionToken } from "../legal/deletion-tokens";

// The life of a CPA deletion request up to "confirmed" (plan 35 §1). Recording
// keeps one pending request per address, and confirming takes the person's
// deliberate action: opening the emailed link only checks it, because mail
// scanners open links on delivery and a confirmed request is acted on.

export type RecordResult = { kind: "created"; id: string } | { kind: "already_open"; id: string };

/**
 * Record a new request for `email`, replacing any earlier one that was never
 * confirmed (its link stops working), so someone being harassed through the
 * form gets one live link rather than a pile. An address that already has a
 * confirmed, open request gets nothing new: it's in the queue already.
 */
export async function recordDeletionRequest(params: {
  email: string;
  tokenHash: string;
  expires: Date;
}): Promise<RecordResult> {
  const { email, tokenHash, expires } = params;
  return db.transaction(async (tx) => {
    const [open] = await tx
      .select({ id: deletionRequests.id })
      .from(deletionRequests)
      .where(and(eq(deletionRequests.email, email), eq(deletionRequests.status, "confirmed")))
      .limit(1);
    if (open) return { kind: "already_open", id: open.id };

    await tx
      .delete(deletionRequests)
      .where(and(eq(deletionRequests.email, email), eq(deletionRequests.status, "pending_confirmation")));
    const [row] = await tx
      .insert(deletionRequests)
      .values({ email, tokenHash, tokenExpiresAt: expires })
      .returning({ id: deletionRequests.id });
    if (!row) throw new Error("deletion_requests insert returned no rows");
    return { kind: "created", id: row.id };
  });
}

export type LinkState =
  | { kind: "pending" }
  | { kind: "confirmed"; id: string }
  | { kind: "invalid" }
  | { kind: "expired" };

/** What the emailed link points at. Read-only: opening the link changes nothing. */
export async function checkDeletionLink(token: string): Promise<LinkState> {
  const [row] = await db
    .select({
      id: deletionRequests.id,
      status: deletionRequests.status,
      tokenExpiresAt: deletionRequests.tokenExpiresAt,
    })
    .from(deletionRequests)
    .where(eq(deletionRequests.tokenHash, hashDeletionToken(token)))
    .limit(1);
  if (!row) return { kind: "invalid" };
  // Confirmed or completed: show the confirmation again, never re-notify.
  if (row.status !== "pending_confirmation") return { kind: "confirmed", id: row.id };
  if (row.tokenExpiresAt.getTime() < Date.now()) return { kind: "expired" };
  return { kind: "pending" };
}

export type ConfirmResult =
  | { kind: "confirmed"; id: string; email: string; confirmedAt: Date }
  | { kind: "already"; id: string }
  | { kind: "mismatch" }
  | { kind: "invalid" }
  | { kind: "expired" };

/**
 * Confirm the request behind `token`, if `typedEmail` is the address it was
 * made for. Typing the address is what a mail scanner that submits forms can't
 * do. The update is guarded on status, so two submits confirm (and notify)
 * once.
 */
export async function confirmDeletionRequest(token: string, typedEmail: string): Promise<ConfirmResult> {
  const [row] = await db
    .select({
      id: deletionRequests.id,
      email: deletionRequests.email,
      status: deletionRequests.status,
      tokenExpiresAt: deletionRequests.tokenExpiresAt,
    })
    .from(deletionRequests)
    .where(eq(deletionRequests.tokenHash, hashDeletionToken(token)))
    .limit(1);
  if (!row) return { kind: "invalid" };
  if (row.status !== "pending_confirmation") return { kind: "already", id: row.id };
  if (row.tokenExpiresAt.getTime() < Date.now()) return { kind: "expired" };
  if (typedEmail.trim().toLowerCase() !== row.email) return { kind: "mismatch" };

  const confirmedAt = new Date();
  const updated = await db
    .update(deletionRequests)
    .set({ status: "confirmed", confirmedAt })
    .where(and(eq(deletionRequests.id, row.id), eq(deletionRequests.status, "pending_confirmation")))
    .returning({ id: deletionRequests.id });
  if (updated.length === 0) return { kind: "already", id: row.id };
  return { kind: "confirmed", id: row.id, email: row.email, confirmedAt };
}
