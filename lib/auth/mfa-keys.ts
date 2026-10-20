import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// TOTP secret encryption with a key id (plan 36 H3), so the key can be rotated
// without breaking every user's two-factor. Pure: the key set is passed in, so
// the portal (lib/auth/mfa.ts, from env) and the re-encrypt script share it.
//
// Stored form: "v1:<kid>:<ivB64>:<tagB64>:<ciphertextB64>" (AES-256-GCM, so a
// tampered value fails to decrypt). Values written before key ids are the old
// three-part "iv:tag:ciphertext" and belong to kid "k1": the original
// MFA_ENCRYPTION_KEY.

const CIPHER = "aes-256-gcm";
export const LEGACY_KID = "k1";
const KID = /^[A-Za-z0-9_-]{1,16}$/;

export interface MfaKeySet {
  /** The kid new secrets are encrypted with. */
  current: string;
  keys: ReadonlyMap<string, Buffer>;
}

function keyFromHex(name: string, hex: string): Buffer {
  const key = Buffer.from(hex, "hex");
  if (!/^[0-9a-fA-F]{64}$/.test(hex) || key.length !== 32) throw new Error(`${name} must be 32 bytes (64 hex chars).`);
  return key;
}

/** The key set from the two env values: MFA_ENCRYPTION_KEYS ("kid:hex,kid:hex",
 *  the first is current) and the original MFA_ENCRYPTION_KEY (kid k1). With
 *  only the original set, it is current. Throws on anything malformed. */
export function parseMfaKeys(packed: string | undefined, legacyHex: string | undefined): MfaKeySet {
  const keys = new Map<string, Buffer>();
  let current: string | null = null;
  for (const entry of (packed ?? "").split(",").map((e) => e.trim()).filter(Boolean)) {
    const i = entry.indexOf(":");
    const kid = i < 0 ? "" : entry.slice(0, i);
    if (!KID.test(kid)) throw new Error("MFA_ENCRYPTION_KEYS entries must be kid:hex.");
    if (keys.has(kid)) throw new Error(`MFA_ENCRYPTION_KEYS lists ${kid} twice.`);
    keys.set(kid, keyFromHex(`MFA_ENCRYPTION_KEYS ${kid}`, entry.slice(i + 1)));
    current ??= kid;
  }
  if (legacyHex) {
    const legacy = keyFromHex("MFA_ENCRYPTION_KEY", legacyHex);
    const listed = keys.get(LEGACY_KID);
    if (listed && !listed.equals(legacy)) {
      throw new Error("MFA_ENCRYPTION_KEYS k1 differs from MFA_ENCRYPTION_KEY; they are the same key.");
    }
    keys.set(LEGACY_KID, legacy);
    current ??= LEGACY_KID;
  }
  if (!current) {
    throw new Error(
      "No MFA encryption key is set (MFA_ENCRYPTION_KEYS or MFA_ENCRYPTION_KEY). Generate one with `openssl rand -hex 32`.",
    );
  }
  return { current, keys };
}

/** Which kid encrypted a stored secret. */
export function secretKid(stored: string): string {
  const parts = stored.split(":");
  if (parts[0] === "v1" && parts.length === 5) return parts[1]!;
  if (parts.length === 3) return LEGACY_KID;
  throw new Error("Malformed encrypted TOTP secret.");
}

export function encryptWith(set: MfaKeySet, plaintext: string): string {
  const key = set.keys.get(set.current);
  if (!key) throw new Error(`MFA key ${set.current} is missing.`);
  const iv = randomBytes(12);
  const cipher = createCipheriv(CIPHER, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", set.current, iv.toString("base64"), cipher.getAuthTag().toString("base64"), enc.toString("base64")].join(":");
}

export function decryptWith(set: MfaKeySet, stored: string): string {
  const kid = secretKid(stored);
  const parts = stored.split(":");
  const [ivB64, tagB64, encB64] = parts.length === 5 ? parts.slice(2) : parts;
  const key = set.keys.get(kid);
  if (!key) throw new Error(`MFA key ${kid} is not configured; it's still needed to read some secrets.`);
  if (!ivB64 || !tagB64 || !encB64) throw new Error("Malformed encrypted TOTP secret.");
  const decipher = createDecipheriv(CIPHER, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encB64, "base64")), decipher.final()]).toString("utf8");
}
