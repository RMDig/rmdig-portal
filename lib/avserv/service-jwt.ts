import { importPKCS8, SignJWT } from "jose";

import { env } from "../env";
import { DEFAULT_KID, parseServiceKey } from "./service-key";

// Mints the short-lived Ed25519 service JWT that authenticates this portal to
// AvServ's internal tier (rmdig-ai docs/plans/05 §"service / S2S trust tier").
//
// Shape locked by the cross-repo contract:
//   header  { alg: "EdDSA", kid: AVSERV_SERVICE_JWT_KID (svc-key-portal-1 today) }
//   claims  { iss: "rmdig-portal", aud: "internal", iat, exp }  (exp <= 5 min)
//
// The private key is that kid's PRIVATE half, held only in Vercel env as
// AVSERV_SERVICE_JWT_SIGNING_KEY_B64 (lib/avserv/service-key.ts). AvServ verifies against the
// published PUBLIC half. This module is server-only — never import it into a
// client component (it touches the private key).

const ISS = "rmdig-portal";
const AUD = "internal";
const ALG = "EdDSA";

// Five-minute ceiling per the contract. We sign for slightly less to leave room
// for clock skew without ever exceeding the verifier's max-age assumption.
const TTL_SECONDS = 4 * 60;

let cachedKeyPromise: Promise<CryptoKey> | null = null;

async function getSigningKey(): Promise<CryptoKey> {
  // Fail loud: callers gate on mock:// before reaching here, so a missing or
  // malformed key on the real path is a misconfiguration, never a runtime
  // condition to paper over. The build check normally stops it first.
  const key = parseServiceKey(env.AVSERV_SERVICE_JWT_SIGNING_KEY_B64);
  if (!key.ok) throw new Error(`${key.error} Set the service key, or point AVSERV_BASE_URL at mock://localhost for local dev.`);
  // Cache the imported key, not the env read: importPKCS8 is the expensive part
  // and the key is stable for the process lifetime.
  cachedKeyPromise ??= importPKCS8(key.pem, ALG);
  return cachedKeyPromise;
}

/** The key id the portal signs as (AvServ picks the verifying key by it). */
export function serviceJwtKid(): string {
  return env.AVSERV_SERVICE_JWT_KID || DEFAULT_KID;
}

/**
 * Sign a service JWT for an AvServ internal-tier request. Returns the compact
 * JWS string to place in the `Authorization: Bearer` header. Throws if the
 * signing key is absent or unparseable — callers on the real path treat that as
 * fatal; the mock path never calls this.
 */
export async function signServiceJwt(): Promise<string> {
  const key = await getSigningKey();
  return new SignJWT({})
    .setProtectedHeader({ alg: ALG, kid: serviceJwtKid() })
    .setIssuer(ISS)
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(key);
}

// Exposed for tests and for any future verify-side parity checks.
export const SERVICE_JWT = { ISS, AUD, ALG, TTL_SECONDS } as const;
