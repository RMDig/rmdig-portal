import { z } from "zod";

// Wire shapes for AvServ account restrictions (contract restrictions.md rev 1
// §1), shared by the live client (restrictions.ts) and the mock.

/** contract §1: `portal:` or `operator:`, then 1–64 of [A-Za-z0-9._@-]. */
export const ACTOR_PATTERN = /^(portal|operator):[A-Za-z0-9._@-]{1,64}$/;

export const RestrictionSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  // Scopes and reason codes are open sets on the portal side: a new value from
  // AvServ must render, not break the review page.
  scope: z.string().min(1),
  state: z.enum(["pending", "active", "lifted"]),
  reasonCode: z.string().min(1),
  userReason: z.string().min(1),
  operatorNote: z.string().nullable(),
  issuedBy: z.string().regex(ACTOR_PATTERN),
  issuedAt: z.string().min(1),
  activatedAt: z.string().nullable(),
  liftedAt: z.string().nullable(),
  liftNote: z.string().nullable(),
  liftedBy: z.string().regex(ACTOR_PATTERN).nullable(),
});
export type Restriction = z.infer<typeof RestrictionSchema>;

export const RestrictionListSchema = z.object({ restrictions: z.array(RestrictionSchema) });

export interface LiftInput {
  /** Required, 1–1000 code points; staff-only on AvServ. */
  note: string;
  /** `portal:<staffUserId>`. */
  liftedBy: string;
}
