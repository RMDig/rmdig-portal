import { z } from "zod";

import { env } from "../env";
import { signServiceJwt } from "./service-jwt";

// Shared plumbing for every call on AvServ's internal (S2S) tier: the error
// type, mock detection, the status causes every endpoint shares, and one fetch
// wrapper that signs the service JWT and bounds the call. Endpoint modules
// (client.ts, agreement.ts) keep their own status interpretation.

const MOCK_SCHEME = "mock://";

// Bound every real call so a stalled AvServ never hangs a request.
export const REQUEST_TIMEOUT_MS = 4000;

/** Thrown when AvServ is unreachable, misconfigured, or answers with a failure.
 *  `status` is the HTTP status when one arrived; `code` is AvServ's
 *  machine-readable `code` field when the body carried one. */
export class AvServError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "AvServError";
  }
}

export function isMock(baseUrl: string): boolean {
  return baseUrl.startsWith(MOCK_SCHEME);
}

// Maps the failure statuses every internal-tier call shares to an AvServError,
// or null when the status is success or an endpoint-specific code the caller
// must interpret itself (400/404). Keeps the operator-facing causes — bad
// service JWT (401) and an unconfigured/disabled service tier (503) — diagnosed
// identically across calls. AvServ returns 503 ("service tier not configured")
// when AVSERV_SERVICE_KEYS is absent, so the live cut fails loud and obvious
// rather than as a generic 5xx.
export function commonStatusError(status: number): AvServError | null {
  if (status === 401) {
    return new AvServError("AvServ rejected the service JWT (401)", 401);
  }
  if (status === 503) {
    return new AvServError(
      "AvServ service tier is not configured (503) — check AVSERV_SERVICE_KEYS on AvServ",
      503,
    );
  }
  return null;
}

/**
 * One signed internal-tier request. Network errors, timeouts and signing
 * failures (missing key on the real path) all surface as {@link AvServError}
 * with no status; the caller interprets every status itself.
 */
export async function avservFetch(
  baseUrl: string,
  path: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
): Promise<Response> {
  try {
    const token = await signServiceJwt();
    return await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
      method: init.method,
      headers: { authorization: `Bearer ${token}`, ...init.headers },
      body: init.body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new AvServError(`AvServ request failed: ${(err as Error).message}`);
  }
}

/**
 * One internal-tier request that is safe to repeat on the other node: a read,
 * or a write whose duplicate is harmless (a second link code just expires).
 * Tries AVSERV_BASE_URL, then AVSERV_FAILOVER_BASE_URL when nothing arrived or
 * the node answered 5xx/503. Returns the last node's response with
 * `viaFailover`, so the caller can read a failover 404 as replication lag
 * rather than "unknown account". Throws {@link AvServError} only when no node
 * answered at all.
 *
 * Never use it for POST /v1/internal/accounts: account ids are random per
 * node, so a retry after a lost response can create a second account for the
 * same email and stall replication between the nodes (AvServ inbox.go).
 */
export async function fetchOnAnyNode(
  primary: string,
  path: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
): Promise<{ res: Response; viaFailover: boolean }> {
  const nodes = [primary, env.AVSERV_FAILOVER_BASE_URL].filter((u): u is string => !!u);
  let lastError: AvServError | undefined;
  let lastRes: { res: Response; viaFailover: boolean } | undefined;
  for (const [i, node] of nodes.entries()) {
    try {
      const res = await avservFetch(node, path, init);
      lastRes = { res, viaFailover: i > 0 };
      if (res.status < 500) return lastRes;
    } catch (err) {
      lastError = err as AvServError;
    }
  }
  // A node that answered (even 5xx) says more than a timeout on the other.
  if (lastRes) return lastRes;
  throw lastError!;
}

// ── Contract calls (account_agreement.md, restrictions.md) ───────────────────
// The newer S2S contracts share one error body ({code, error}), one failover
// rule (retry the same idempotency key on the other node) and Zod-validated
// responses. These helpers carry that shape for every contract client.

/** A failure from a contract endpoint. `code` is AvServ's machine-readable
 *  code, `detail` its human-readable `error` text, and `viaFailover` marks an
 *  answer from the failover node, where a 404 not-found is replication lag. */
export class AvServContractError extends AvServError {
  readonly viaFailover: boolean;
  readonly detail: string | undefined;

  constructor(
    message: string,
    opts: { status?: number; code?: string; detail?: string; viaFailover?: boolean } = {},
  ) {
    super(message, opts.status, opts.code);
    this.name = "AvServContractError";
    this.viaFailover = opts.viaFailover ?? false;
    this.detail = opts.detail;
  }
}

/** AVSERV_BASE_URL, or a loud error naming what could not be reached. */
export function contractBaseUrl(purpose: string): string {
  const baseUrl = env.AVSERV_BASE_URL;
  if (!baseUrl) {
    throw new AvServContractError(
      `AVSERV_BASE_URL is not set — cannot reach AvServ for ${purpose}. ` +
        "Set it to mock://localhost for local dev or the real AvServ base URL.",
    );
  }
  return baseUrl;
}

const ErrorBodySchema = z.object({ code: z.string().optional(), error: z.string().optional() });

// Every non-2xx carries {code, error}, except the 401 (service JWT) and the 503
// "service tier not configured", which carry only `error`: callers key on the
// status for those.
export async function contractFailure(res: Response, viaFailover: boolean): Promise<AvServContractError> {
  if (res.status === 401) {
    return new AvServContractError("AvServ rejected the service JWT (401)", { status: 401, viaFailover });
  }
  const parsed = ErrorBodySchema.safeParse(await res.json().catch(() => null));
  const code = parsed.success ? parsed.data.code : undefined;
  const detail = parsed.success ? parsed.data.error : undefined;
  return new AvServContractError(`AvServ answered ${res.status}${code ? ` ${code}` : ""}`, {
    status: res.status,
    code,
    detail,
    viaFailover,
  });
}

export async function parseContractOk<T>(res: Response, schema: z.ZodType<T>, what: string): Promise<T> {
  const parsed = schema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) {
    throw new AvServContractError(`AvServ ${what} response failed schema validation`, {
      status: res.status,
    });
  }
  return parsed.data;
}

/** A failure worth repeating on the other node: nothing arrived
 *  (network/timeout), or the node answered 5xx/503. */
export function retryableOnOtherNode(err: AvServContractError): boolean {
  return err.status === undefined || err.status >= 500;
}

/**
 * One contract call against the primary node and, when it fails in a way
 * `retryOn` accepts, once more against AVSERV_FAILOVER_BASE_URL with the SAME
 * request (and so the same idempotency key). One node's success is the answer.
 */
export async function callWithFailover<T>(
  primary: string,
  path: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
  schema: z.ZodType<T>,
  what: string,
  retryOn: (err: AvServContractError) => boolean = retryableOnOtherNode,
): Promise<T> {
  const nodes = [primary, env.AVSERV_FAILOVER_BASE_URL].filter((u): u is string => !!u);
  let last: AvServContractError | undefined;
  for (const [i, node] of nodes.entries()) {
    const viaFailover = i > 0;
    try {
      const res = await avservFetch(node, path, init);
      if (res.ok) return await parseContractOk(res, schema, what);
      last = await contractFailure(res, viaFailover);
    } catch (err) {
      if (err instanceof AvServContractError) throw err;
      last = new AvServContractError((err as Error).message, {
        status: (err as AvServError).status,
        viaFailover,
      });
    }
    if (!retryOn(last)) break;
  }
  // The loop ran at least once and leaves only by returning, throwing, or
  // recording a failure, so `last` is set.
  throw last!;
}
