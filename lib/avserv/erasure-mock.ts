import type { ErasurePreview, ErasureRecord } from "./erasure-types";

// mock:// answers for local dev and the e2e gate. Two fixed account ids act
// out the refusals: one has a live check-out, one belongs to someone else.
// Erased ids are remembered for the process, so status reads them back.

export const MOCK_LIVE_ACCOUNT_ID = "00000000-0000-4000-8000-0000000011fe";
export const MOCK_MISMATCH_ACCOUNT_ID = "00000000-0000-4000-8000-00000000badd";

const erased = new Map<string, ErasureRecord>();

export function mockPreview(accountId: string): ErasurePreview {
  const done = erased.has(accountId);
  const live = !done && accountId === MOCK_LIVE_ACCOUNT_ID ? [{ kind: "checkout", id: "mock-checkout-1" }] : [];
  return { accountId, node: "mock", alreadyErased: done, erasable: !done && live.length === 0, live };
}

export function mockErase(
  accountId: string,
  body: { requestRef: string },
  reader: string,
): { ok: true; value: ErasureRecord } | { ok: false; status: number; code: string } {
  if (accountId === MOCK_MISMATCH_ACCOUNT_ID) return { ok: false, status: 409, code: "email_mismatch" };
  if (accountId === MOCK_LIVE_ACCOUNT_ID) return { ok: false, status: 409, code: "erasure_blocked_active" };
  const seen = erased.get(accountId);
  if (seen) return { ok: true, value: { ...seen, alreadyErased: true } };
  const now = new Date().toISOString();
  const record: ErasureRecord = {
    accountId,
    alreadyErased: false,
    requestRef: body.requestRef,
    evidence: "tombstone",
    originNode: "mock",
    requestedAt: now,
    appliedAt: now,
    rows: { accounts: 1, checkouts: 2, contacts: 1 },
    requestedByKid: "svc-key-portal-erasure",
    reader,
  };
  erased.set(accountId, record);
  return { ok: true, value: record };
}

export function mockStatus(accountId: string): ErasureRecord | null {
  const r = erased.get(accountId);
  return r ? { ...r, alreadyErased: true } : null;
}
