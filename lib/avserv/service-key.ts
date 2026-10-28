import { createHash, createPrivateKey, createPublicKey } from "node:crypto";

// The portal's AvServ service-JWT key (kid svc-key-portal-1 today), stored as
// ONE base64 line: base64 of the PKCS#8 PEM file. A multi-line PEM pasted into
// an env var was mangled once (quotes, escapes) and broke every signed call
// for as long as nobody noticed; a single opaque line can't be. Checked at
// build time (scripts/check-service-key.ts) and on first use. Errors never
// echo key material.

export const DEFAULT_KID = "svc-key-portal-1";
export const DEVICE_ADMIN_KID = "svc-key-portal-device-admin-1";
export const ERASURE_KID = "svc-key-portal-erasure";
export const KID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export type ServiceKey = { ok: true; pem: string; fingerprint: string } | { ok: false; error: string };

/** SHA-256 of the DER public key: what AvServ prints for the kid with
 *  `openssl pkey -pubin -in <kid>.pub -outform DER | shasum -a 256`. */
function fingerprintOf(pem: string): string {
  const spki = createPublicKey(createPrivateKey(pem)).export({ type: "spki", format: "der" });
  return createHash("sha256").update(spki).digest("hex");
}

export function parseServiceKey(
  b64: string | undefined,
  name: string = "AVSERV_SERVICE_JWT_SIGNING_KEY_B64",
): ServiceKey {
  if (!b64) return { ok: false, error: `${name} is not set.` };
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) {
    return { ok: false, error: `${name} must be one base64 line: no quotes, spaces or line breaks.` };
  }
  const pem = Buffer.from(b64, "base64").toString("utf8");
  if (!pem.startsWith("-----BEGIN PRIVATE KEY-----") || !pem.includes("-----END PRIVATE KEY-----")) {
    return { ok: false, error: `${name} must be the base64 of a PKCS#8 PEM (-----BEGIN PRIVATE KEY-----).` };
  }
  try {
    const key = createPrivateKey(pem);
    if (key.asymmetricKeyType !== "ed25519") {
      return { ok: false, error: `The AvServ service key must be Ed25519, not ${key.asymmetricKeyType ?? "unknown"}.` };
    }
    return { ok: true, pem, fingerprint: fingerprintOf(pem) };
  } catch {
    return { ok: false, error: `${name} decodes to a PEM that isn't a readable private key.` };
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

const KID_NAMES: Array<[string, string]> = [
  [DEFAULT_KID, "everyday"],
  [DEVICE_ADMIN_KID, "device-admin"],
  [ERASURE_KID, "erasure"],
];

export type OptionalKeyCheck =
  | { status: "skipped" | "absent" | "ok"; kid?: string; fingerprint?: string }
  | { status: "error"; error: string };

/** The check for a single-purpose key (device admin, erasure), which is
 *  optional: absent means "not installed yet" (its UI says so), not a broken
 *  build. Present but wrong, set without its fingerprint, or sharing another
 *  key's kid, fails like the everyday key. */
function checkOptionalKey(
  e: { AVSERV_BASE_URL?: string } & Record<string, string | undefined>,
  prefix: string,
  defaultKid: string,
  label: string,
): OptionalKeyCheck {
  if (!e.AVSERV_BASE_URL || e.AVSERV_BASE_URL.startsWith("mock://")) return { status: "skipped" };
  const b64 = e[`${prefix}_SIGNING_KEY_B64`];
  if (!b64) return { status: "absent" };
  const kid = e[`${prefix}_KID`] || defaultKid;
  if (!KID_PATTERN.test(kid)) return { status: "error", error: `${prefix}_KID "${kid}" isn't a valid key id.` };
  const taken = KID_NAMES.find(([k]) => k === kid && k !== defaultKid);
  if (taken) return { status: "error", error: `${prefix}_KID must not be the ${taken[1]} kid ${kid}.` };
  const key = parseServiceKey(b64, `${prefix}_SIGNING_KEY_B64`);
  if (!key.ok) return { status: "error", error: key.error };
  const want = e[`${prefix}_KEY_SHA256`]?.toLowerCase();
  if (!want) return { status: "error", error: `${prefix}_KEY_SHA256 is not set (this key's is ${key.fingerprint}; check it against AvServ's for ${kid}).` };
  if (want !== key.fingerprint) {
    return { status: "error", error: `The ${label} key's public half (${key.fingerprint}) doesn't match ${prefix}_KEY_SHA256 (${want}) for ${kid}.` };
  }
  return { status: "ok", kid, fingerprint: key.fingerprint };
}

/** The device-admin key (plan 36 S3): revoke and the App Lock reset code. */
export function checkDeviceAdminKeyConfig(e: {
  AVSERV_BASE_URL?: string;
  AVSERV_DEVICE_ADMIN_JWT_SIGNING_KEY_B64?: string;
  AVSERV_DEVICE_ADMIN_JWT_KID?: string;
  AVSERV_DEVICE_ADMIN_JWT_KEY_SHA256?: string;
}): OptionalKeyCheck {
  return checkOptionalKey(e, "AVSERV_DEVICE_ADMIN_JWT", DEVICE_ADMIN_KID, "device-admin");
}

/** The erasure key (AvServ account_erasure.md, plan 47 §2): account erasure
 *  and nothing else. Production-scoped only in Vercel. */
export function checkErasureKeyConfig(e: {
  AVSERV_BASE_URL?: string;
  AVSERV_ERASURE_JWT_SIGNING_KEY_B64?: string;
  AVSERV_ERASURE_JWT_KID?: string;
  AVSERV_ERASURE_JWT_KEY_SHA256?: string;
}): OptionalKeyCheck {
  return checkOptionalKey(e, "AVSERV_ERASURE_JWT", ERASURE_KID, "erasure");
}
