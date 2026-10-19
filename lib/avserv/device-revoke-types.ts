import { z } from "zod";

// Shapes from AvServ docs/contracts/device_revoke.md rev 2 (AvServ #310,
// c51f63d), and rev 2.1 (#311): a `checkout` preview item carries its dueAt.
// Specified, not built: the portal runs them against the mock.

export const REVOKE_REASONS = ["lost", "stolen", "user"] as const;
export type RevokeReason = (typeof REVOKE_REASONS)[number];
export type RevokeMode = "limited" | "full";

/** How THIS portal session last proved who it is (§3.3). AvServ derives the
 *  mode: full only for a passkey enrolled at least 7 days before. */
export type AuthStrength =
  | { method: "passkey"; passkeyCreatedAt: string }
  | { method: "password" }
  | { method: "other" };

// `kind` is a closed list (checkout, help_request, held), but it's parsed as
// any string so a kind the portal doesn't know is shown generically rather
// than failing the whole preview, and is never named in a log (plan 36 rule 3).
export const PreviewSchema = z.object({
  accountId: z.string(),
  deviceId: z.string(),
  node: z.string(),
  revoked: z.boolean(),
  // dueAt (rev 2.1) is optional so a node still on rev 2 parses.
  live: z.array(z.object({ kind: z.string(), id: z.string().nullable(), dueAt: z.string().optional() })),
});
export type Preview = z.infer<typeof PreviewSchema>;

const Mode = z.enum(["limited", "full"]);

export const RevokeSchema = z.object({
  accountId: z.string(),
  deviceId: z.string(),
  node: z.string(),
  revokedAt: z.string(),
  reason: z.enum(REVOKE_REASONS),
  mode: Mode,
  alreadyRevoked: z.boolean(),
  upgraded: z.boolean(),
});
export type RevokeAnswer = z.infer<typeof RevokeSchema>;

export const RevokeOthersSchema = z.object({
  accountId: z.string(),
  node: z.string(),
  keptDeviceId: z.string().nullable(),
  revoked: z.array(
    z.object({
      deviceId: z.string(),
      revokedAt: z.string(),
      mode: Mode,
      alreadyRevoked: z.boolean(),
      upgraded: z.boolean(),
    }),
  ),
});
export type RevokeOthersAnswer = z.infer<typeof RevokeOthersSchema>;

/** One node's answer to a fan-out call: its body, or why it has none. */
export type NodeAnswer<T> =
  | { node: string; ok: true; value: T }
  | { node: string; ok: false; status?: number; code?: string };

const FULL_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** AvServ's rule (rev 2 §1.1): `full` only for a passkey enrolled at least 7
 *  days before now; everything else is `limited`. AvServ decides; the portal
 *  uses the same rule to say which it will be before the user confirms. */
export function predictRevokeMode(strength: AuthStrength, now: Date): RevokeMode {
  if (strength.method !== "passkey") return "limited";
  const created = new Date(strength.passkeyCreatedAt).getTime();
  return !Number.isNaN(created) && now.getTime() - created >= FULL_AFTER_MS ? "full" : "limited";
}
