import type { env } from "../env";

// MFA enforcement policy. Pure decision logic (no DB/session) so it's trivially
// testable; the portal layout supplies the inputs and acts on the verdict.
//
// Policy (MFA_ENFORCEMENT):
//   optional   — MFA is available but never pushed.
//   admin_only — rmdig staff (any platform role) and SAR org admins MUST
//                enroll (org admins manage members and will publish team
//                terms, docs/plans/33); everyone else is nagged but not blocked.
//   all        — every user MUST enroll.

export type MfaEnforcement = (typeof env)["MFA_ENFORCEMENT"];

export type MfaGate =
  | "ok" // nothing to do
  | "nag" // encourage enrollment, but allow through
  | "required"; // block until enrolled

export interface MfaGateInput {
  enforcement: MfaEnforcement;
  mfaEnabled: boolean;
  isStaff: boolean;
  /** Admin of at least one SAR organization. */
  isOrgAdmin: boolean;
}

export function evaluateMfaGate({ enforcement, mfaEnabled, isStaff, isOrgAdmin }: MfaGateInput): MfaGate {
  if (mfaEnabled) return "ok";
  switch (enforcement) {
    case "all":
      return "required";
    case "admin_only":
      return isStaff || isOrgAdmin ? "required" : "nag";
    case "optional":
      return "ok";
  }
}
