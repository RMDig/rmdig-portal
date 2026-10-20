import { isSealed, keyFromHex, open, parsePackedKeys, seal, sealedKid, type KeySet } from "../crypto/keyed-aes";

// TOTP secret encryption with a key id (plan 36 H3), so the key can be rotated
// without breaking every user's two-factor. Pure: the key set is passed in, so
// the portal (lib/auth/mfa.ts, from env) and the re-encrypt script share it.
//
// Stored form: the sealed form of lib/crypto/keyed-aes.ts. Values written
// before key ids are the old three-part "iv:tag:ciphertext" and belong to kid
// "k1": the original MFA_ENCRYPTION_KEY.

export const LEGACY_KID = "k1";

export type MfaKeySet = KeySet;

/** The key set from the two env values: MFA_ENCRYPTION_KEYS ("kid:hex,kid:hex",
 *  the first is current) and the original MFA_ENCRYPTION_KEY (kid k1). With
 *  only the original set, it is current. Throws on anything malformed. */
export function parseMfaKeys(packed: string | undefined, legacyHex: string | undefined): MfaKeySet {
  const { keys, current: listed } = parsePackedKeys("MFA_ENCRYPTION_KEYS", packed);
  let current = listed;
  if (legacyHex) {
    const legacy = keyFromHex("MFA_ENCRYPTION_KEY", legacyHex);
    const k1 = keys.get(LEGACY_KID);
    if (k1 && !k1.equals(legacy)) {
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

/** A legacy three-part value as the sealed form it would have under k1. */
function asSealed(stored: string): string {
  if (isSealed(stored)) return stored;
  if (stored.split(":").length === 3) return `v1:${LEGACY_KID}:${stored}`;
  throw new Error("Malformed encrypted TOTP secret.");
}

/** Which kid encrypted a stored secret. */
export function secretKid(stored: string): string {
  return sealedKid(asSealed(stored));
}

export function encryptWith(set: MfaKeySet, plaintext: string): string {
  return seal(set, plaintext);
}

export function decryptWith(set: MfaKeySet, stored: string): string {
  return open(set, asSealed(stored));
}
