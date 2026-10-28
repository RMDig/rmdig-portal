import { importPKCS8, SignJWT } from "jose";

import { env } from "../env";
import { DEFAULT_KID, DEVICE_ADMIN_KID, ERASURE_KID, parseServiceKey } from "./service-key";

// Mints the short-lived Ed25519 service JWT that authenticates this portal to
// AvServ's internal tier (rmdig-ai docs/plans/05 §"service / S2S trust tier").
//
// Shape locked by the cross-repo contract:
//   header  { alg: "EdDSA", kid }
//   claims  { iss: "rmdig-portal", aud: "internal", iat, exp }  (exp <= 5 min)
//
// Three keys, by role. "default" (svc-key-portal-1) signs every everyday call.
// "device_admin" (svc-key-portal-device-admin-1, plan 36 S3) signs only the
// device_admin routes (revoke, revoke preview, revoke-others, App Lock reset
// code). "erasure" (svc-key-portal-erasure, AvServ plan 47 §2) signs only
// account erasure. AvServ grants each nothing else, and a role never borrows
// another's key. The private halves live only in Vercel env (lib/avserv/service-key.ts).
// Server-only: never import this into a client component.

const ISS = "rmdig-portal";
const AUD = "internal";
const ALG = "EdDSA";

// Five-minute ceiling per the contract. We sign for slightly less to leave room
// for clock skew without ever exceeding the verifier's max-age assumption.
const TTL_SECONDS = 4 * 60;

export type KeyRole = "default" | "device_admin" | "erasure";

const ROLE = {
  default: {
    keyVar: "AVSERV_SERVICE_JWT_SIGNING_KEY_B64",
    key: () => env.AVSERV_SERVICE_JWT_SIGNING_KEY_B64,
    kid: () => env.AVSERV_SERVICE_JWT_KID || DEFAULT_KID,
  },
  device_admin: {
    keyVar: "AVSERV_DEVICE_ADMIN_JWT_SIGNING_KEY_B64",
    key: () => env.AVSERV_DEVICE_ADMIN_JWT_SIGNING_KEY_B64,
    kid: () => env.AVSERV_DEVICE_ADMIN_JWT_KID || DEVICE_ADMIN_KID,
  },
  erasure: {
    keyVar: "AVSERV_ERASURE_JWT_SIGNING_KEY_B64",
    key: () => env.AVSERV_ERASURE_JWT_SIGNING_KEY_B64,
    kid: () => env.AVSERV_ERASURE_JWT_KID || ERASURE_KID,
  },
} as const;

const cachedKeys = new Map<KeyRole, Promise<CryptoKey>>();

async function getSigningKey(role: KeyRole): Promise<CryptoKey> {
  // Fail loud: callers gate on mock:// before reaching here, so a missing or
  // malformed key on the real path is a misconfiguration, never a runtime
  // condition to paper over. The build check normally stops it first.
  const key = parseServiceKey(ROLE[role].key(), ROLE[role].keyVar);
  if (!key.ok) throw new Error(`${key.error} Set the service key, or point AVSERV_BASE_URL at mock://localhost for local dev.`);
  // Cache the imported key, not the env read: importPKCS8 is the expensive part
  // and the key is stable for the process lifetime.
  let cached = cachedKeys.get(role);
  if (!cached) {
    cached = importPKCS8(key.pem, ALG);
    cachedKeys.set(role, cached);
  }
  return cached;
}

/** The key id the portal signs as for `role` (AvServ picks the verifying key by it). */
export function serviceJwtKid(role: KeyRole = "default"): string {
  return ROLE[role].kid();
}

/** Whether the device-admin key is configured at all. Without it, revoke is
 *  "not available yet" rather than a fault (AvServ installs the kid only after
 *  its revoke build ships). */
export function deviceAdminKeyConfigured(): boolean {
  return !!env.AVSERV_DEVICE_ADMIN_JWT_SIGNING_KEY_B64;
}

/** Whether the erasure key is configured. Without it, the admin queue says
 *  to erase by hand (runbook); it never falls back to another key. */
export function erasureKeyConfigured(): boolean {
  return !!env.AVSERV_ERASURE_JWT_SIGNING_KEY_B64;
}

/**
 * Sign a service JWT for an AvServ internal-tier request, as `role`. Returns
 * the compact JWS string for the `Authorization: Bearer` header. Throws if that
 * role's key is absent or unparseable; the mock path never calls this.
 */
export async function signServiceJwt(role: KeyRole = "default"): Promise<string> {
  const key = await getSigningKey(role);
  return new SignJWT({})
    .setProtectedHeader({ alg: ALG, kid: serviceJwtKid(role) })
    .setIssuer(ISS)
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(key);
}

// Exposed for tests and for any future verify-side parity checks.
export const SERVICE_JWT = { ISS, AUD, ALG, TTL_SECONDS } as const;
