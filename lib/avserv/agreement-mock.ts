import { isIP } from "node:net";

import { presentedAgreement } from "../agreement";
import { codePointLength, LEGAL_NAME_MAX, normalizeName, passesAlertNameRule } from "../agreement/names";
import {
  type AcceptBody,
  type AcceptResult,
  AgreementError,
  type AvaiAccount,
  type IdentityInput,
} from "./agreement-types";
import { mockEmailForAccount } from "./client";

// In-process stand-in for AvServ's onboarding endpoints under AVSERV_BASE_URL=
// mock://* (local dev and the E2E gate). It keeps per-account state for the
// process lifetime and reproduces the contract's refusals that the portal must
// handle: identity validation, idempotent replay, key conflicts, hash and
// wording mismatches, missing attestations, a missing browser IP. Capture is
// always on; the published version is whatever the portal presents, so an
// unpinned build sees agreement_not_published exactly as it would live today.

interface MockAcceptance {
  acceptanceId: string;
  version: string;
  acceptedAt: string;
  legalName: string;
}

interface MockAccount {
  identityVersion: number;
  legalName: string | null;
  displayName: string | null;
  activatedAt: string | null;
  acceptances: MockAcceptance[];
}

const accounts = new Map<string, MockAccount>();

/** Test-only: forget every mock account. */
export function __resetAgreementMock(): void {
  accounts.clear();
  receipts.clear();
}

function state(accountId: string): MockAccount {
  let a = accounts.get(accountId);
  if (!a) {
    a = { identityVersion: 0, legalName: null, displayName: null, activatedAt: null, acceptances: [] };
    accounts.set(accountId, a);
  }
  return a;
}

function refuse(status: number, code: string, message: string): AgreementError {
  return new AgreementError(`AvServ (mock) answered ${status} ${code}`, {
    status,
    code,
    detail: message,
  });
}

function body(accountId: string, a: MockAccount): AvaiAccount {
  const current = presentedAgreement()?.version ?? null;
  const email = mockEmailForAccount(accountId);
  return {
    accountId,
    identityVersion: a.identityVersion,
    legalName: a.legalName,
    displayName: a.displayName,
    email,
    emailVerified: email !== null,
    activated: a.activatedAt !== null,
    activatedAt: a.activatedAt,
    acceptances: a.acceptances.map(({ acceptanceId, version, acceptedAt }) => ({
      acceptanceId,
      version,
      acceptedAt,
    })),
    agreement: {
      currentVersion: current,
      needsAcceptance:
        current !== null &&
        !a.acceptances.some((x) => x.version === current && x.legalName === a.legalName),
      required: false,
    },
  };
}

// A simplified legal-name check (starts with a letter; letters, combining
// marks after letters, and the contract's punctuation). Enough to exercise the
// portal's error path; AvServ's own rule is the real one.
function validLegalName(s: string): boolean {
  const n = codePointLength(s);
  if (n === 0 || n > LEGAL_NAME_MAX) return false;
  return /^\p{L}(?:[\p{L}\p{Mn}\p{Mc}]|[ \-'\u2019.,](?=\p{L}|[ \-'\u2019.,]|$))*$/u.test(s);
}

function applyIdentity(a: MockAccount, input: IdentityInput): void {
  let legal: string | undefined;
  let display: string | undefined;
  if (input.legalName !== undefined) {
    legal = normalizeName(input.legalName);
    if (!validLegalName(legal)) {
      throw refuse(400, "invalid_legal_name", "legalName must be 1-100 characters of letters, spaces, hyphens, apostrophes, periods or commas");
    }
  }
  if (input.displayName !== undefined) {
    if (!passesAlertNameRule(input.displayName)) {
      throw refuse(400, "invalid_display_name", "displayName must be 1-40 characters of letters, spaces, hyphens or apostrophes (it appears in alert texts, so no digits or symbols)");
    }
    display = normalizeName(input.displayName).replace(/\u2019/g, "'");
  }
  let changed = false;
  if (legal !== undefined && legal !== a.legalName) {
    a.legalName = legal;
    changed = true;
  }
  if (display !== undefined && display !== a.displayName) {
    a.displayName = display;
    changed = true;
  }
  if (changed) a.identityVersion += 1;
}

export async function getAccount(accountId: string): Promise<AvaiAccount> {
  return body(accountId, state(accountId));
}

export async function putIdentity(accountId: string, input: IdentityInput): Promise<AvaiAccount> {
  if ("email" in input) throw refuse(400, "email_not_accepted", "the portal's email is its verified login");
  const a = state(accountId);
  applyIdentity(a, input);
  return body(accountId, a);
}

// Per-key receipts: the same key replays the same answer (contract §3.3).
const receipts = new Map<string, { version: string; result: AcceptResult }>();

export async function accept(accountId: string, key: string, req: AcceptBody): Promise<AcceptResult> {
  const prior = receipts.get(key);
  if (prior) {
    if (prior.version !== req.version) {
      throw refuse(409, "idempotency_conflict", "this acceptance id was already used for a different version");
    }
    return prior.result;
  }
  const presented = presentedAgreement();
  if (!presented) throw refuse(404, "agreement_not_published", "no agreement is published yet");
  if (req.version !== presented.version) {
    throw refuse(503, "agreement_version_unknown", "this node does not have that agreement version yet");
  }
  if (req.assent.presentedInFull !== true) throw refuse(400, "invalid_assent", "presentedInFull must be true");
  if (req.contentHash !== presented.contentHash) {
    throw refuse(409, "agreement_hash_mismatch", "the text you rendered is not this version");
  }
  if (req.assent.textHash !== presented.assent.textHash) {
    throw refuse(409, "agreement_wording_mismatch", "the assent line does not match this version");
  }
  for (const sent of req.attestations) {
    const spec = presented.attestations.find((x) => x.id === sent.id);
    if (!spec) throw refuse(400, "invalid_attestations", `unknown attestation ${sent.id}`);
    if (sent.textHash !== spec.textHash) {
      throw refuse(409, "agreement_wording_mismatch", `attestation ${sent.id} wording does not match`);
    }
  }
  for (const spec of presented.attestations.filter((x) => x.required)) {
    if (!req.attestations.some((x) => x.id === spec.id)) {
      throw refuse(400, "attestation_missing", `required attestation ${spec.id} was not affirmed`);
    }
  }
  if (isIP(req.client.ip.trim()) === 0) {
    throw refuse(400, "invalid_client_ip", "client.ip must carry the browser's IP address");
  }

  const a = state(accountId);
  if (req.identity) applyIdentity(a, req.identity);
  if (!a.legalName || !a.displayName) {
    throw refuse(422, "identity_incomplete", "legal name and display name are required");
  }
  const now = new Date().toISOString();
  a.acceptances.push({ acceptanceId: key, version: req.version, acceptedAt: now, legalName: a.legalName });
  a.activatedAt ??= now;
  const result: AcceptResult = {
    acceptanceId: key,
    version: req.version,
    activated: true,
    activatedAt: a.activatedAt,
  };
  receipts.set(key, { version: req.version, result });
  return result;
}
