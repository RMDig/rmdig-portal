import * as Sentry from "@sentry/nextjs";

import { AgreementError } from "../avserv/agreement-types";
import { SUPPORT_EMAIL } from "../legal/compliance-copy";
import { logger } from "../logger";

// What the user sees, and how loudly we hear about it, for every AvServ answer
// on the onboarding tier (docs/plans/31 §5; contract account_agreement.md rev 2
// §3.3, §4). Every failure reaches the user; none is queued or swallowed.
//  - field:       the user can fix it (AvServ's own message is shown).
//  - unavailable: onboarding is not open yet (capture off / nothing published).
//  - retry:       transient; the same idempotency key is kept for the retry.
//  - support:     the account needs an operator (suspended or retired).
//  - fault:       a portal bug or a stale pin — logged at error and sent to Sentry.

export type AgreementFailureKind = "field" | "unavailable" | "retry" | "support" | "fault";

export interface AgreementFailure {
  kind: AgreementFailureKind;
  message: string;
  field?: "legalName" | "displayName";
}

const FAULT_MESSAGE = "Something went wrong on our side, and we've been notified. Please try again later.";
const STALE_PIN_MESSAGE =
  "This agreement was just updated, and we're publishing the new version. Please try again later.";
const RETRY_MESSAGE = "AvAI couldn't be reached. Please try again in a few minutes.";

// Codes that can only come from a bug in what the portal sent.
const PORTAL_BUG_CODES = new Set([
  "invalid_json",
  "invalid_idempotency_key",
  "invalid_assent",
  "invalid_attestations",
  "invalid_client_ip",
  "email_not_accepted",
  "invalid_account_id",
  "attestation_declined",
  "attestation_missing",
  "identity_locked",
  "idempotency_conflict",
]);

// A pinned portal can't re-fetch: these mean the pin is stale and a release is
// needed (contract §4; AvServ keeps a superseded version accepted >= 30 days).
const STALE_PIN_CODES = new Set([
  "agreement_hash_mismatch",
  "agreement_wording_mismatch",
  "agreement_version_retired",
]);

export function classifyAgreementError(err: unknown): AgreementFailure {
  if (!(err instanceof AgreementError)) {
    return { kind: "fault", message: FAULT_MESSAGE };
  }
  const code = err.code;
  if (code === "invalid_legal_name") {
    return { kind: "field", field: "legalName", message: detail(err) };
  }
  if (code === "invalid_display_name") {
    return { kind: "field", field: "displayName", message: detail(err) };
  }
  if (code === "identity_incomplete") {
    return { kind: "field", message: "Fill in your legal name and the name on your alerts." };
  }
  if (code === "agreement_capture_disabled" || code === "agreement_not_published") {
    return { kind: "unavailable", message: "AvAI account setup isn't available yet." };
  }
  if (code === "account_not_found") {
    // On the failover node a brand-new account may not have replicated yet
    // (contract §4); on the primary it means an operator suspended or retired
    // the account (§3.1) — never loop the user, send them to support.
    return err.viaFailover
      ? { kind: "retry", message: "Your AvAI account is still being set up. Try again in a minute." }
      : {
          kind: "support",
          message: `Your AvAI account needs attention. Contact ${SUPPORT_EMAIL} and we'll help.`,
        };
  }
  if (code && STALE_PIN_CODES.has(code)) return { kind: "fault", message: STALE_PIN_MESSAGE };
  if (code && PORTAL_BUG_CODES.has(code)) return { kind: "fault", message: FAULT_MESSAGE };
  if (err.status === undefined || err.status >= 500) return { kind: "retry", message: RETRY_MESSAGE };
  // 401 (service JWT) and any status/code the contract doesn't name.
  return { kind: "fault", message: FAULT_MESSAGE };
}

function detail(err: AgreementError): string {
  return err.detail ?? "Please check this field.";
}

/** Log an onboarding failure at the level its kind deserves; faults also go to
 *  Sentry, because a portal bug or stale pin blocks every user until fixed. */
export function reportAgreementFailure(
  event: string,
  failure: AgreementFailure,
  err: unknown,
  context: Record<string, unknown>,
): void {
  const code = err instanceof AgreementError ? err.code : undefined;
  const status = err instanceof AgreementError ? err.status : undefined;
  const fields = { event, kind: failure.kind, code, status, ...context };
  if (failure.kind === "fault") {
    logger.error({ ...fields, err });
    Sentry.captureException(err, { tags: { event, code: code ?? "none" } });
  } else if (failure.kind === "retry" || failure.kind === "support") {
    logger.warn({ ...fields, err });
  } else {
    logger.info(fields);
  }
}
