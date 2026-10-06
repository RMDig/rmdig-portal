import { createHash, createPrivateKey, createPublicKey } from "node:crypto";

// The portal's AvServ service-JWT key (kid svc-key-portal-1 today), stored as
// ONE base64 line: base64 of the PKCS#8 PEM file. A multi-line PEM pasted into
// an env var was mangled once (quotes, escapes) and broke every signed call
// for as long as nobody noticed; a single opaque line can't be. Checked at
// build time (scripts/check-service-key.ts) and on first use. Errors never
// echo key material.

export const DEFAULT_KID = "svc-key-portal-1";
export const KID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export type ServiceKey = { ok: true; pem: string; fingerprint: string } | { ok: false; error: string };

/** SHA-256 of the DER public key: what AvServ prints for the kid with
 *  `openssl pkey -pubin -in <kid>.pub -outform DER | shasum -a 256`. */
function fingerprintOf(pem: string): string {
  const spki = createPublicKey(createPrivateKey(pem)).export({ type: "spki", format: "der" });
  return createHash("sha256").update(spki).digest("hex");
}

export function parseServiceKey(b64: string | undefined): ServiceKey {
  if (!b64) return { ok: false, error: "AVSERV_SERVICE_JWT_SIGNING_KEY_B64 is not set." };
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) {
    return { ok: false, error: "AVSERV_SERVICE_JWT_SIGNING_KEY_B64 must be one base64 line: no quotes, spaces or line breaks." };
  }
  const pem = Buffer.from(b64, "base64").toString("utf8");
  if (!pem.startsWith("-----BEGIN PRIVATE KEY-----") || !pem.includes("-----END PRIVATE KEY-----")) {
    return { ok: false, error: "AVSERV_SERVICE_JWT_SIGNING_KEY_B64 must be the base64 of a PKCS#8 PEM (-----BEGIN PRIVATE KEY-----)." };
  }
  try {
    const key = createPrivateKey(pem);
    if (key.asymmetricKeyType !== "ed25519") {
      return { ok: false, error: `The AvServ service key must be Ed25519, not ${key.asymmetricKeyType ?? "unknown"}.` };
    }
    return { ok: true, pem, fingerprint: fingerprintOf(pem) };
  } catch {
    return { ok: false, error: "AVSERV_SERVICE_JWT_SIGNING_KEY_B64 decodes to a PEM that isn't a readable private key." };
  }
}

/** The whole configuration check the build runs, and what a wrong key looks
 *  like: unset or malformed, not Ed25519, an invalid kid, or a public half
 *  that doesn't match the fingerprint AvServ holds for the kid. */
export function checkServiceKeyConfig(e: {
  AVSERV_BASE_URL?: string;
  AVSERV_SERVICE_JWT_SIGNING_KEY_B64?: string;
  AVSERV_SERVICE_JWT_KID?: string;
  AVSERV_SERVICE_JWT_KEY_SHA256?: string;
}): { status: "skipped" | "ok"; kid?: string; fingerprint?: string } | { status: "error"; error: string } {
  if (!e.AVSERV_BASE_URL || e.AVSERV_BASE_URL.startsWith("mock://")) return { status: "skipped" };
  const kid = e.AVSERV_SERVICE_JWT_KID || DEFAULT_KID;
  if (!KID_PATTERN.test(kid)) return { status: "error", error: `AVSERV_SERVICE_JWT_KID "${kid}" isn't a valid key id.` };
  const key = parseServiceKey(e.AVSERV_SERVICE_JWT_SIGNING_KEY_B64);
  if (!key.ok) return { status: "error", error: key.error };
  const want = e.AVSERV_SERVICE_JWT_KEY_SHA256?.toLowerCase();
  if (!want) return { status: "error", error: `AVSERV_SERVICE_JWT_KEY_SHA256 is not set (this key's is ${key.fingerprint}; check it against AvServ's for ${kid}).` };
  if (want !== key.fingerprint) {
    return { status: "error", error: `The signing key's public half (${key.fingerprint}) doesn't match AVSERV_SERVICE_JWT_KEY_SHA256 (${want}) for ${kid}.` };
  }
  return { status: "ok", kid, fingerprint: key.fingerprint };
}
