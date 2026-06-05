import { createHash } from "node:crypto";

import { env } from "../env";
import { signServiceJwt } from "./service-jwt";

// Server-to-server client for AvServ's internal tier (rmdig-ai docs/plans/05).
// The portal links each user to a canonical AvServ account; AvServ owns the
// safety domain. We talk to it server-side only, authenticated with a
// short-lived Ed25519 service JWT — never a browser token.
//
// Mock-first: when AVSERV_BASE_URL starts with `mock://`, every call resolves
// against a deterministic in-process fake (no network, no signing key). That
// lets the login→map and mint-code flows run end-to-end locally and in CI
// before AvServ ships the real endpoints. Cut to live by pointing
// AVSERV_BASE_URL at the real base.

const MOCK_SCHEME = "mock://";

// Bound every real call so a stalled AvServ never blocks a login request.
const REQUEST_TIMEOUT_MS = 4000;

export interface AvServAccount {
  /** Canonical AvServ account UUID this portal user maps to. */
  accountId: string;
  /** True when AvServ created the account on this call, false when it already existed. */
  created: boolean;
}

/** Thrown when AvServ is unreachable, misconfigured, or returns an unexpected
 *  status. Callers on the login path treat this as transient: log and retry on
 *  the next sign-in, never block the user. */
export class AvServError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AvServError";
  }
}

function isMock(baseUrl: string): boolean {
  return baseUrl.startsWith(MOCK_SCHEME);
}

// Deterministic, namespaced fake UUID derived from the email so the mock is
// stable across calls and processes (same email → same accountId). Shaped like
// a v5 UUID (version nibble 5, RFC-4122 variant) so it round-trips through the
// `avserv_account_id uuid` column.
function mockAccountId(email: string): string {
  const hex = createHash("sha256")
    .update(`avserv-mock-account:${email}`)
    .digest("hex")
    .slice(0, 32);
  // Splice in the v5 version nibble (pos 12) and the RFC-4122 variant (pos 16).
  const variant = ((parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);
  const id = hex.slice(0, 12) + "5" + hex.slice(13, 16) + variant + hex.slice(17, 32);
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20, 32)}`;
}

// Tracks emails the mock has "seen" this process so it can report `created`
// honestly (first call true, subsequent false) — mirrors real idempotency and
// lets tests assert it. Not persistence; just intra-process fidelity.
const mockSeenEmails = new Set<string>();

/** Test-only: reset the mock's seen-email memory between cases. */
export function __resetAvServMock(): void {
  mockSeenEmails.clear();
}

/**
 * Find-or-create the AvServ account for a verified email (P-B1). Idempotent on
 * email; safe to call on every login. Throws {@link AvServError} on any failure
 * — the login-map caller catches and retries next time, never blocking login.
 */
export async function findOrCreateAccount(email: string): Promise<AvServAccount> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    throw new AvServError("findOrCreateAccount called with an empty email");
  }

  const baseUrl = env.AVSERV_BASE_URL;
  if (!baseUrl) {
    throw new AvServError(
      "AVSERV_BASE_URL is not set — cannot map this user to an AvServ account. " +
        "Set it to mock://localhost for local dev or the real AvServ base URL.",
    );
  }

  if (isMock(baseUrl)) {
    const created = !mockSeenEmails.has(normalized);
    mockSeenEmails.add(normalized);
    return { accountId: mockAccountId(normalized), created };
  }

  let res: Response;
  try {
    const token = await signServiceJwt();
    res = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/internal/accounts`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: normalized }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    // Network error, timeout, or a signing failure (missing key on the real
    // path). All transient or operator-fixable; surface as AvServError.
    throw new AvServError(`AvServ request failed: ${(err as Error).message}`);
  }

  if (res.status === 401) {
    // Bad/expired service JWT — an operator problem (key mismatch), not the
    // user's. Distinct status so logs make the cause obvious.
    throw new AvServError("AvServ rejected the service JWT (401)", 401);
  }
  if (res.status === 400) {
    throw new AvServError("AvServ rejected the email as invalid (400)", 400);
  }
  if (!res.ok) {
    throw new AvServError(`AvServ returned unexpected status ${res.status}`, res.status);
  }

  const body = (await res.json().catch(() => null)) as Partial<AvServAccount> | null;
  if (!body || typeof body.accountId !== "string") {
    throw new AvServError("AvServ response missing accountId");
  }
  return { accountId: body.accountId, created: body.created === true };
}

/** True when AvServ integration is configured at all. Callers skip the map
 *  silently when this is false (e.g. very early local setup with no base URL). */
export function isAvServConfigured(): boolean {
  return Boolean(env.AVSERV_BASE_URL);
}
