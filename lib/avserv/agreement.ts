import * as mock from "./agreement-mock";
import {
  type AcceptBody,
  type AcceptResult,
  AcceptResultSchema,
  type AvaiAccount,
  AvaiAccountSchema,
  type IdentityInput,
} from "./agreement-types";
import {
  avservFetch,
  callWithFailover,
  contractBaseUrl,
  contractFailure,
  isMock,
  parseContractOk,
} from "./request";

export * from "./agreement-types";

// S2S client for AvServ plan 23 web onboarding (contract account_agreement.md
// rev 2 §4; docs/plans/31). AvServ is the system of record for identity and
// acceptances; every call here is synchronous and its answer reaches the user.
// Errors carry AvServ's machine-readable `code`; lib/agreement/errors.ts maps
// them to what the user sees.

const PURPOSE = "account onboarding";

const accountPath = (accountId: string) => `/v1/internal/accounts/${encodeURIComponent(accountId)}`;

/** GET /v1/internal/accounts/{id}: a plain read of the §3.1 body. */
export async function getAccount(accountId: string): Promise<AvaiAccount> {
  const baseUrl = contractBaseUrl(PURPOSE);
  if (isMock(baseUrl)) return mock.getAccount(accountId);

  const res = await avservFetch(baseUrl, accountPath(accountId), { method: "GET" });
  if (!res.ok) throw await contractFailure(res, false);
  return parseContractOk(res, AvaiAccountSchema, "account");
}

/** PUT /v1/internal/accounts/{id}/identity. Omitted fields are unchanged; the
 *  portal never sends email (its email is the verified login). */
export async function putIdentity(accountId: string, input: IdentityInput): Promise<AvaiAccount> {
  const baseUrl = contractBaseUrl(PURPOSE);
  if (isMock(baseUrl)) return mock.putIdentity(accountId, input);

  const res = await avservFetch(baseUrl, `${accountPath(accountId)}/identity`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await contractFailure(res, false);
  return parseContractOk(res, AvaiAccountSchema, "identity");
}

/**
 * POST /v1/internal/accounts/{id}/agreement-acceptances. The idempotency key is
 * the acceptance's identity: the SAME key goes to the failover node when the
 * primary is unreachable or answers 5xx, and one node's 200 is the record (§4).
 */
export async function acceptAgreement(
  accountId: string,
  idempotencyKey: string,
  body: AcceptBody,
): Promise<AcceptResult> {
  const primary = contractBaseUrl(PURPOSE);
  if (isMock(primary)) return mock.accept(accountId, idempotencyKey, body);

  return callWithFailover(
    primary,
    `${accountPath(accountId)}/agreement-acceptances`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify(body),
    },
    AcceptResultSchema,
    "acceptance",
  );
}
