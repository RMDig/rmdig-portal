import { createHash } from "node:crypto";

import { z } from "zod";

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

export interface DeviceLinkCode {
  /** Short, human-enterable code the user types into AvApp to link a device. */
  code: string;
  /** ISO-8601 timestamp after which the code is no longer valid. */
  expiresAt: string;
}

// Boundary schema for the linked-devices read endpoint (P-B3,
// GET /v1/internal/accounts/{id}/devices). Mirrors AvServ's `deviceJSON`
// exactly: appVersion is null when the device reported none; createdAt/lastSeenAt
// are RFC3339/UTC strings. Validated with Zod (conventions §5) so a drifted
// AvServ response is rejected loudly rather than rendered as `undefined`.
export const LinkedDeviceSchema = z.object({
  deviceId: z.string().min(1),
  // AvServ constrains platform to a known set (iOS/Android/macOS) today, but we
  // accept any non-empty string: the portal only displays it, so a new platform
  // shipped by AvServ must not break this read-only view.
  platform: z.string().min(1),
  appVersion: z.string().nullable(),
  createdAt: z.string().min(1),
  lastSeenAt: z.string().min(1),
});

/** One device linked to the user's AvServ account, for the read-only
 *  /settings/devices view. Shape is derived from {@link LinkedDeviceSchema}. */
export type LinkedDevice = z.infer<typeof LinkedDeviceSchema>;

const ListDevicesResponseSchema = z.object({
  devices: z.array(LinkedDeviceSchema),
});

// AvServ issues single-use link-codes on a short TTL (10 min per the contract).
// The mock mirrors that window so the UI's "expires at" copy is realistic.
const LINK_CODE_TTL_MS = 10 * 60 * 1000;

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

// Maps the failure statuses every internal-tier call shares to an AvServError,
// or null when the status is success or an endpoint-specific code the caller
// must interpret itself (400/404). Keeps the operator-facing causes — bad
// service JWT (401) and an unconfigured/disabled service tier (503) — diagnosed
// identically across calls. AvServ returns 503 ("service tier not configured")
// when AVSERV_SERVICE_KEYS is absent, so the live cut fails loud and obvious
// rather than as a generic 5xx.
function commonStatusError(status: number): AvServError | null {
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

// Deterministic mock link-code derived from the account id. A real code is
// fresh and single-use each mint; the mock trades that for determinism so the
// mint-code flow is testable without AvServ. Crockford-ish alphabet (no
// ambiguous 0/O/1/I), grouped XXXX-XXXX for easy hand-entry into AvApp.
function mockLinkCode(accountId: string): string {
  const h = createHash("sha256").update(`avserv-mock-linkcode:${accountId}`).digest("hex");
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += alphabet[parseInt(h.slice(i * 2, i * 2 + 2), 16) % alphabet.length];
  }
  return `${out.slice(0, 4)}-${out.slice(4, 8)}`;
}

// Deterministic mock device list derived from the account id, so /settings/devices
// and its E2E render stable rows without a live AvServ. Two devices (an iOS phone
// + a macOS desktop, the second with a null appVersion) exercise list rendering,
// most-recently-seen-first ordering, and the nullable-version path. Timestamps are
// fixed (not Date.now) so the mock is reproducible across processes and assertable.
function mockDevices(accountId: string): LinkedDevice[] {
  const deviceUuid = (salt: string): string => {
    const hex = createHash("sha256").update(`${salt}:${accountId}`).digest("hex").slice(0, 32);
    const variant = ((parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);
    const id = hex.slice(0, 12) + "5" + hex.slice(13, 16) + variant + hex.slice(17, 32);
    return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20, 32)}`;
  };
  return [
    {
      deviceId: deviceUuid("device-1"),
      platform: "iOS",
      appVersion: "1.5.0",
      createdAt: "2026-05-20T14:30:00Z",
      lastSeenAt: "2026-06-04T09:15:00Z",
    },
    {
      deviceId: deviceUuid("device-2"),
      platform: "macOS",
      appVersion: null,
      createdAt: "2026-04-02T11:00:00Z",
      lastSeenAt: "2026-05-28T18:42:00Z",
    },
  ];
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

  const shared = commonStatusError(res.status);
  if (shared) throw shared;
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

/**
 * Mint a single-use device link-code for an AvServ account (P-B2, portal mints
 * / app consumes). The user types the returned code into AvApp to bind a device
 * to this account. Throws {@link AvServError} on any failure; the caller surfaces
 * a retry-friendly message. Unlike the login map, this is user-initiated, so a
 * failure is shown rather than silently retried.
 */
export async function mintLinkCode(accountId: string): Promise<DeviceLinkCode> {
  if (!accountId) {
    throw new AvServError("mintLinkCode called with an empty accountId");
  }

  const baseUrl = env.AVSERV_BASE_URL;
  if (!baseUrl) {
    throw new AvServError(
      "AVSERV_BASE_URL is not set — cannot mint a device link-code. " +
        "Set it to mock://localhost for local dev or the real AvServ base URL.",
    );
  }

  if (isMock(baseUrl)) {
    return {
      code: mockLinkCode(accountId),
      expiresAt: new Date(Date.now() + LINK_CODE_TTL_MS).toISOString(),
    };
  }

  let res: Response;
  try {
    const token = await signServiceJwt();
    res = await fetch(
      `${baseUrl.replace(/\/$/, "")}/v1/internal/accounts/${encodeURIComponent(accountId)}/link-codes`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
  } catch (err) {
    throw new AvServError(`AvServ request failed: ${(err as Error).message}`);
  }

  const shared = commonStatusError(res.status);
  if (shared) throw shared;
  if (res.status === 400) {
    // Malformed accountId. We only ever mint for an id AvServ itself returned,
    // so this means our stored mapping is corrupt — surface it distinctly.
    throw new AvServError("AvServ rejected the account id as malformed (400)", 400);
  }
  if (res.status === 404) {
    // The account id we hold doesn't exist on AvServ — a mapping drift, not a
    // user error. Distinct status so it's diagnosable.
    throw new AvServError("AvServ does not know this account (404)", 404);
  }
  if (!res.ok) {
    throw new AvServError(`AvServ returned unexpected status ${res.status}`, res.status);
  }

  const body = (await res.json().catch(() => null)) as Partial<DeviceLinkCode> | null;
  if (!body || typeof body.code !== "string" || typeof body.expiresAt !== "string") {
    throw new AvServError("AvServ response missing code/expiresAt");
  }
  return { code: body.code, expiresAt: body.expiresAt };
}

/**
 * List the devices linked to an AvServ account (P-B3, read-only). Powers the
 * /settings/devices view. Throws {@link AvServError} on any failure so the page
 * renders an error state rather than 500ing. An account that owns no devices is
 * a successful empty list, never an error (AvServ proves account existence in
 * its store — 404 means the account is unknown, not that it has zero devices).
 */
export async function listDevices(accountId: string): Promise<LinkedDevice[]> {
  if (!accountId) {
    throw new AvServError("listDevices called with an empty accountId");
  }

  const baseUrl = env.AVSERV_BASE_URL;
  if (!baseUrl) {
    throw new AvServError(
      "AVSERV_BASE_URL is not set — cannot list linked devices. " +
        "Set it to mock://localhost for local dev or the real AvServ base URL.",
    );
  }

  if (isMock(baseUrl)) {
    return mockDevices(accountId);
  }

  let res: Response;
  try {
    const token = await signServiceJwt();
    res = await fetch(
      `${baseUrl.replace(/\/$/, "")}/v1/internal/accounts/${encodeURIComponent(accountId)}/devices`,
      {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
  } catch (err) {
    throw new AvServError(`AvServ request failed: ${(err as Error).message}`);
  }

  const shared = commonStatusError(res.status);
  if (shared) throw shared;
  if (res.status === 400) {
    throw new AvServError("AvServ rejected the account id as malformed (400)", 400);
  }
  if (res.status === 404) {
    throw new AvServError("AvServ does not know this account (404)", 404);
  }
  if (!res.ok) {
    throw new AvServError(`AvServ returned unexpected status ${res.status}`, res.status);
  }

  const json = await res.json().catch(() => null);
  const parsed = ListDevicesResponseSchema.safeParse(json);
  if (!parsed.success) {
    // A drifted/garbled response is an integration bug, not a user condition —
    // fail loud rather than render undefined fields.
    throw new AvServError("AvServ devices response failed schema validation");
  }
  return parsed.data.devices;
}

// ── Ad creative publish / unpublish (P2 / v2+, docs/plans/30 §6) ─────────────
// The portal hands AvServ an APPROVED creative; AvServ stores it and rebuilds +
// re-signs the ad manifest (AvApp doc 30 §6, doc 31 §2/§6). Unpublish drops a
// suspended creative from the next manifest. Mock-first like every call above:
// against mock:// these resolve to a deterministic ref / no-op, so the whole
// approve→publish / suspend→unpublish loop is testable before AvServ ships the
// real endpoints. The wire shape follows the proposed contract (docs/plans/30
// §6.2); the byte-level publish endpoint is the one residual not yet pinned in
// doc 31, so treat this as provisional and keep it behind mock:// in dev/CI.

/** The advertiser's chosen target region, or null for app-wide. Matches the
 *  manifest `region` shape (AvApp doc 31 §2). Phase 2 is always app-wide. */
export interface CreativeRegion {
  provider: string;
  zoneId: string;
  zoneSetVersion: number;
}

export interface PublishCreativeInput {
  /** The portal's ad_creatives.id — AvServ echoes it back for reconciliation. */
  portalCreativeId: string;
  slot: string;
  headline: string;
  body: string;
  altText: string;
  clickUrl?: string | null;
  region?: CreativeRegion | null;
}

export interface PublishedCreative {
  /** AvServ's identifier for the published record; stored as avserv_creative_ref. */
  avservCreativeRef: string;
}

// Deterministic mock ref derived from the portal creative id, so approve→publish
// writes a stable, assertable ref without a live AvServ.
function mockCreativeRef(portalCreativeId: string): string {
  const h = createHash("sha256")
    .update(`avserv-mock-ad-creative:${portalCreativeId}`)
    .digest("hex")
    .slice(0, 16);
  return `crv_${h}`;
}

/**
 * Publish an approved creative to AvServ (docs/plans/30 §6). Returns the AvServ
 * ref to store on the creative. Throws {@link AvServError} on any failure — the
 * caller leaves the creative approved-but-unpublished ("approved, not yet live"),
 * never a false "live", and surfaces a retry (no silent failure).
 */
export async function publishCreative(input: PublishCreativeInput): Promise<PublishedCreative> {
  if (!input.portalCreativeId) {
    throw new AvServError("publishCreative called without a portalCreativeId");
  }

  const baseUrl = env.AVSERV_BASE_URL;
  if (!baseUrl) {
    throw new AvServError(
      "AVSERV_BASE_URL is not set — cannot publish an ad creative. " +
        "Set it to mock://localhost for local dev or the real AvServ base URL.",
    );
  }

  if (isMock(baseUrl)) {
    return { avservCreativeRef: mockCreativeRef(input.portalCreativeId) };
  }

  let res: Response;
  try {
    const token = await signServiceJwt();
    res = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/internal/ad-creatives`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new AvServError(`AvServ request failed: ${(err as Error).message}`);
  }

  const shared = commonStatusError(res.status);
  if (shared) throw shared;
  if (!res.ok) {
    throw new AvServError(`AvServ returned unexpected status ${res.status}`, res.status);
  }

  const body = (await res.json().catch(() => null)) as Partial<PublishedCreative> | null;
  if (!body || typeof body.avservCreativeRef !== "string") {
    throw new AvServError("AvServ response missing avservCreativeRef");
  }
  return { avservCreativeRef: body.avservCreativeRef };
}

/**
 * Unpublish a creative from AvServ (docs/plans/30 §6) — used when an approved
 * creative is suspended, so it drops from the next signed manifest. Throws
 * {@link AvServError} on failure; the caller logs loudly (a suspended creative
 * staying live is a real problem, never silently ignored).
 */
export async function unpublishCreative(avservCreativeRef: string): Promise<void> {
  if (!avservCreativeRef) {
    throw new AvServError("unpublishCreative called without a ref");
  }

  const baseUrl = env.AVSERV_BASE_URL;
  if (!baseUrl) {
    throw new AvServError(
      "AVSERV_BASE_URL is not set — cannot unpublish an ad creative. " +
        "Set it to mock://localhost for local dev or the real AvServ base URL.",
    );
  }

  if (isMock(baseUrl)) {
    return;
  }

  let res: Response;
  try {
    const token = await signServiceJwt();
    res = await fetch(
      `${baseUrl.replace(/\/$/, "")}/v1/internal/ad-creatives/${encodeURIComponent(avservCreativeRef)}`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
  } catch (err) {
    throw new AvServError(`AvServ request failed: ${(err as Error).message}`);
  }

  const shared = commonStatusError(res.status);
  if (shared) throw shared;
  // 404 = AvServ already doesn't have it; treat as success (idempotent unpublish).
  if (res.status === 404) {
    return;
  }
  if (!res.ok) {
    throw new AvServError(`AvServ returned unexpected status ${res.status}`, res.status);
  }
}

/** True when AvServ integration is configured at all. Callers skip the map
 *  silently when this is false (e.g. very early local setup with no base URL). */
export function isAvServConfigured(): boolean {
  return Boolean(env.AVSERV_BASE_URL);
}
