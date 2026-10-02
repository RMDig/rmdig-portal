import { z } from "zod";

import { ACTOR_PATTERN, type Restriction } from "../avserv/restrictions-types";

// Review-request rules shared by the user page and the staff queue
// (docs/plans/32; AvServ contract restrictions.md rev 1).

/** What each restriction scope takes away, in the user's words. Scopes are an
 *  open set on the wire; an unknown one renders as its raw name. */
const SCOPE_LABEL: Record<string, string> = {
  incident_detection: "Automatic Incident Detection",
};

export function scopeLabel(scope: string): string {
  return SCOPE_LABEL[scope] ?? scope;
}

/** The restrictions a user can ask to have reviewed: the ones in force. A
 *  pending restriction was never announced to them (contract §6), and a lifted
 *  one needs no review. */
export function reviewableRestrictions(all: Restriction[]): Restriction[] {
  return all.filter((r) => r.state === "active");
}

/** The actor AvServ records for a staff member acting in the portal (§1). */
export function staffActor(userId: string): string {
  const actor = `portal:${userId}`;
  if (!ACTOR_PATTERN.test(actor)) {
    // Portal user ids are UUIDs, which always fit; anything else is a bug.
    throw new Error(`user id does not fit the AvServ actor pattern: ${userId}`);
  }
  return actor;
}

export const REVIEW_MESSAGE_MIN = 20;
export const REVIEW_MESSAGE_MAX = 2000;

export const reviewRequestSchema = z.object({
  restrictionId: z.string().uuid("Unknown restriction."),
  submissionKey: z.string().uuid(),
  message: z
    .string()
    .trim()
    .min(REVIEW_MESSAGE_MIN, `Tell us a bit more (at least ${REVIEW_MESSAGE_MIN} characters).`)
    .max(REVIEW_MESSAGE_MAX, `Keep it under ${REVIEW_MESSAGE_MAX} characters.`),
});

/** Staff decisions. `close` is for a restriction already lifted elsewhere. The
 *  note is required for every decision (contract §4 requires one on lift; the
 *  audit log requires one for all). */
export const reviewDecisionSchema = z.object({
  requestId: z.string().uuid("Unknown request."),
  decision: z.enum(["uphold", "lift", "close"]),
  // AvServ's liftNote bound (§1): 1–1000 code points.
  note: z
    .string()
    .trim()
    .min(1, "Add a note: it goes in the audit log.")
    .refine((s) => [...s].length <= 1000, "Keep the note under 1000 characters."),
});
export type ReviewDecision = z.infer<typeof reviewDecisionSchema>["decision"];
