import { z } from "zod";

import { env } from "../env";
import * as mock from "./agreement-mock";
import {
  type AcceptBody,
  type AcceptResult,
  AcceptResultSchema,
  AgreementError,
  type AvaiAccount,
  AvaiAccountSchema,
  type IdentityInput,
} from "./agreement-types";
import { type AvServError, avservFetch, isMock } from "./request";

export * from "./agreement-types";

// S2S client for AvServ plan 23 web onboarding (contract account_agreement.md
// rev 2 §4; docs/plans/31). AvServ is the system of record for identity and
// acceptances; every call here is synchronous and its answer reaches the user.
// Errors carry AvServ's machine-readable `code`; lib/agreement/errors.ts maps
// them to what the user sees.

function primaryBaseUrl(): string {
  const baseUrl = env.AVSERV_BASE_URL;
  if (!baseUrl) {
    throw new AgreementError(
      "AVSERV_BASE_URL is not set — cannot reach AvServ for account onboarding. " +
        "Set it to mock://localhost for local dev or the real AvServ base URL.",
    );
  }
  return baseUrl;
}

const ErrorBodySchema = z.object({ code: z.string().optional(), error: z.string().optional() });

// Every non-2xx on this tier carries {code, error}. 401 is the shared
// service-JWT cause and has no useful code.
async function failure(res: Response, viaFailover: boolean): Promise<AgreementError> {
  if (res.status === 401) {
    return new AgreementError("AvServ rejected the service JWT (401)", { status: 401, viaFailover });
  }
  const parsed = ErrorBodySchema.safeParse(await res.json().catch(() => null));
  const code = parsed.success ? parsed.data.code : undefined;
  const detail = parsed.success ? parsed.data.error : undefined;
  return new AgreementError(`AvServ answered ${res.status}${code ? ` ${code}` : ""}`, {
    status: res.status,
    code,
    detail,
    viaFailover,
  });
}

async function parseOk<T>(res: Response, schema: z.ZodType<T>, what: string): Promise<T> {
  const parsed = schema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) {
    throw new AgreementError(`AvServ ${what} response failed schema validation`, {
      status: res.status,
    });
  }
  return parsed.data;
}

const accountPath = (accountId: string) => `/v1/internal/accounts/${encodeURIComponent(accountId)}`;

/** GET /v1/internal/accounts/{id}: a plain read of the §3.1 body. */
export async function getAccount(accountId: string): Promise<AvaiAccount> {
  const baseUrl = primaryBaseUrl();
  if (isMock(baseUrl)) return mock.getAccount(accountId);

  const res = await avservFetch(baseUrl, accountPath(accountId), { method: "GET" });
  if (!res.ok) throw await failure(res, false);
  return parseOk(res, AvaiAccountSchema, "account");
}

/** PUT /v1/internal/accounts/{id}/identity. Omitted fields are unchanged; the
 *  portal never sends email (its email is the verified login). */
export async function putIdentity(accountId: string, input: IdentityInput): Promise<AvaiAccount> {
  const baseUrl = primaryBaseUrl();
  if (isMock(baseUrl)) return mock.putIdentity(accountId, input);

  const res = await avservFetch(baseUrl, `${accountPath(accountId)}/identity`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await failure(res, false);
  return parseOk(res, AvaiAccountSchema, "identity");
}

// A failure worth retrying on the other node with the same key: nothing
// arrived (network/timeout), or the node answered 5xx/503 (contract §3.3).
function retryableOnOtherNode(err: AgreementError): boolean {
  return err.status === undefined || err.status >= 500;
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
  const primary = primaryBaseUrl();
  if (isMock(primary)) return mock.accept(accountId, idempotencyKey, body);

  const nodes = [primary, env.AVSERV_FAILOVER_BASE_URL].filter((u): u is string => !!u);
  let last: AgreementError | undefined;
  for (const [i, node] of nodes.entries()) {
    const viaFailover = i > 0;
    try {
      const res = await avservFetch(node, `${accountPath(accountId)}/agreement-acceptances`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify(body),
      });
      if (res.ok) return await parseOk(res, AcceptResultSchema, "acceptance");
      last = await failure(res, viaFailover);
    } catch (err) {
      if (err instanceof AgreementError) throw err;
      last = new AgreementError((err as Error).message, {
        status: (err as AvServError).status,
        viaFailover,
      });
    }
    if (!retryableOnOtherNode(last)) break;
  }
  // `last` is always set here: the loop ran at least once and only exits by
  // returning, throwing, or recording a failure.
  throw last!;
}
