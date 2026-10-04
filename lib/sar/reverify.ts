// When to remind about a ski patrol's annual re-verification (AvApp doc 36
// §9.3; AvServ sar_team_sync.md: "a patrol past reverifyBy is not usable").
// Staff re-verify by calling the patrol's published number; the patrol's
// admins get a heads-up and, if it lapses, the consequence. Pure.

export const REMINDER_STAGES = ["due_30", "due_7", "lapsed"] as const;
export type ReminderStage = (typeof REMINDER_STAGES)[number];

const DAY_MS = 86_400_000;

/** The stage a patrol is in now, or null when nothing is due. Only the
 *  current stage is sent: a run that missed days never sends the stale ones. */
export function reminderStage(reverifyBy: Date, now: Date): ReminderStage | null {
  const days = Math.ceil((reverifyBy.getTime() - now.getTime()) / DAY_MS);
  if (days <= 0) return "lapsed";
  if (days <= 7) return "due_7";
  if (days <= 30) return "due_30";
  return null;
}

/** Staff get every stage; the patrol's own admins the first notice and the lapse. */
export function patrolAdminsNotified(stage: ReminderStage): boolean {
  return stage !== "due_7";
}

/** How far ahead the run looks (the earliest stage). */
export const LOOKAHEAD_DAYS = 30;
