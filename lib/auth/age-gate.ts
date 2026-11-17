import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

// The 18+ statement (owner, 2026-11-16; /terms §1 and /privacy Children, in
// counsel's words). The email sign-up form records it at sign-up; everyone
// else (Google sign-ups, accounts made before it) confirms once on
// /confirm-age, where the portal layout sends them until it's recorded.
//
// The layout gate is a statement gate, not an access control: server actions
// don't pass through layouts, so an action reached directly isn't refused.
// That's accepted: the record is the person's own representation, and nothing
// a portal action does depends on their age.

export const AGE_CONFIRM_PATH = "/confirm-age";

/** True once this account has confirmed it is 18 or older. */
export async function ageConfirmed(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ ageConfirmedAt: users.ageConfirmedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return !!row?.ageConfirmedAt;
}

/** Records the confirmation. Only the first one is kept (a second submit, say
 *  from another tab, changes nothing). False when no such user exists. */
export async function recordAgeConfirmation(userId: string, now: Date = new Date()): Promise<boolean> {
  await db
    .update(users)
    .set({ ageConfirmedAt: now })
    .where(and(eq(users.id, userId), isNull(users.ageConfirmedAt)));
  return ageConfirmed(userId);
}
