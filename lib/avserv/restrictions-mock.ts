import { createHash } from "node:crypto";

import { mockEmailForAccount } from "./client";
import { AvServContractError } from "./request";
import type { LiftInput, Restriction } from "./restrictions-types";

// In-process stand-in for AvServ's restriction endpoints under
// AVSERV_BASE_URL=mock://* (local dev and the E2E gate). Nothing issues
// restrictions from the portal, so the mock seeds one: an account mapped from
// a login email whose local part carries a "+restricted" tag (for example
// e2e-review+restricted@rmdig.test) starts with one active Incident Detection
// restriction. Every other account has none. State lives for the process.

const accounts = new Map<string, Restriction[]>();

/** Test-only: forget every mock account. */
export function __resetRestrictionsMock(): void {
  accounts.clear();
}

// Deterministic v5-shaped UUID, stable across processes for the same account.
function mockUuid(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32);
  const variant = ((parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);
  const id = hex.slice(0, 12) + "5" + hex.slice(13, 16) + variant + hex.slice(17, 32);
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20, 32)}`;
}

export const MOCK_USER_REASON =
  "Automatic Incident Detection was paused after a review of recent automatic alerts from this account.";

function seeded(accountId: string): Restriction[] {
  const email = mockEmailForAccount(accountId);
  if (!email || !email.split("@")[0]?.includes("+restricted")) return [];
  return [
    {
      id: mockUuid(`avserv-mock-restriction:${accountId}`),
      accountId,
      scope: "incident_detection",
      state: "active",
      reasonCode: "incident_abuse",
      userReason: MOCK_USER_REASON,
      operatorNote: "Mock: 7 automatic suspects in 24 h, none escalated.",
      issuedBy: "operator:mock",
      issuedAt: "2026-09-28T16:00:00Z",
      activatedAt: "2026-09-28T18:30:00Z",
      liftedAt: null,
      liftNote: null,
      liftedBy: null,
    },
  ];
}

function state(accountId: string): Restriction[] {
  let list = accounts.get(accountId);
  if (!list) {
    list = seeded(accountId);
    accounts.set(accountId, list);
  }
  return list;
}

export async function listRestrictions(accountId: string): Promise<Restriction[]> {
  // Contract §2 order: issuedAt descending, then id descending.
  return [...state(accountId)].sort(
    (a, b) => b.issuedAt.localeCompare(a.issuedAt) || b.id.localeCompare(a.id),
  );
}

export async function liftRestriction(
  accountId: string,
  restrictionId: string,
  input: LiftInput,
): Promise<Restriction> {
  const row = state(accountId).find((r) => r.id === restrictionId);
  if (!row) {
    // Unknown and another account's id are indistinguishable (§4).
    throw new AvServContractError("AvServ (mock) answered 404 restriction_not_found", {
      status: 404,
      code: "restriction_not_found",
      detail: "no such restriction on this account",
    });
  }
  if (row.state !== "lifted") {
    // The first lift's note, actor and time stand; a retry changes nothing.
    row.state = "lifted";
    row.liftedAt = new Date().toISOString();
    row.liftNote = input.note;
    row.liftedBy = input.liftedBy;
  }
  return { ...row };
}
