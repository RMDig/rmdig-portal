import { db } from "../db";
import { accountSecurityEvents, type AccountSecurityEventKind } from "../db/schema";

// Writes to account_security_events (lib/db/schema.ts). Pass the transaction
// when the change itself is in one, so the record and the change land together.

type Executor = Pick<typeof db, "insert">;

export async function recordSecurityEvent(
  executor: Executor,
  event: { userId: string; kind: AccountSecurityEventKind; sessionId?: string | null },
): Promise<void> {
  await executor.insert(accountSecurityEvents).values({
    userId: event.userId,
    kind: event.kind,
    sessionId: event.sessionId ?? null,
  });
}
