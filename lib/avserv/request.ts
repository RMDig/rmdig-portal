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
