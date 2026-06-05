import { importPKCS8, SignJWT } from "jose";

import { env } from "../env";

// Mints the short-lived Ed25519 service JWT that authenticates this portal to
// AvServ's internal tier (rmdig-ai docs/plans/05 §"service / S2S trust tier").
//
// Shape locked by the cross-repo contract:
//   header  { alg: "EdDSA", kid: "svc-key-portal-1" }
//   claims  { iss: "rmdig-portal", aud: "internal", iat, exp }  (exp <= 5 min)
//
// The private key is the svc-key-portal-1 PRIVATE half, PKCS#8 PEM, held only in
// Vercel env as AVSERV_SERVICE_JWT_SIGNING_KEY. AvServ verifies against the
// published PUBLIC half. This module is server-only — never import it into a
// client component (it touches the private key).

const KID = "svc-key-portal-1";
const ISS = "rmdig-portal";
const AUD = "internal";
const ALG = "EdDSA";

// Five-minute ceiling per the contract. We sign for slightly less to leave room
// for clock skew without ever exceeding the verifier's max-age assumption.
const TTL_SECONDS = 4 * 60;

// PEM keys live in env as single-line strings with literal "\n" escapes (the
// same Option-A convention APPLE_PRIVATE_KEY uses). Restore real newlines before
// jose parses the PKCS#8 block.
function normalizePem(pem: string): string {
  return pem.includes("\\n") ? pem.replace(/\\n/g, "\n") : pem;
}

let cachedKeyPromise: Promise<CryptoKey> | null = null;

async function getSigningKey(): Promise<CryptoKey> {
  const raw = env.AVSERV_SERVICE_JWT_SIGNING_KEY;
  if (!raw) {
    // Fail loud: callers must gate on mock:// before reaching here, so a missing
    // key on the real path is a misconfiguration, not a runtime condition to
    // paper over.
    throw new Error(
      "AVSERV_SERVICE_JWT_SIGNING_KEY is not set — cannot sign an AvServ service JWT. " +
        "Set the svc-key-portal-1 private key, or point AVSERV_BASE_URL at mock://localhost for local dev.",
    );
  }
  // Cache the imported key, not the env read — importPKCS8 is the expensive part
  // and the key is stable for the process lifetime.
  if (!cachedKeyPromise) {
    cachedKeyPromise = importPKCS8(normalizePem(raw), ALG);
  }
  return cachedKeyPromise;
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
    .setProtectedHeader({ alg: ALG, kid: KID })
    .setIssuer(ISS)
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(key);
}

// Exposed for tests and for any future verify-side parity checks.
export const SERVICE_JWT = { KID, ISS, AUD, ALG, TTL_SECONDS } as const;
