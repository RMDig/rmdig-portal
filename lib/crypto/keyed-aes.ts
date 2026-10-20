import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM with a key id, so a key can be rotated without breaking what it
// already encrypted (plan 36 H3, H4). Pure: the key set is passed in. Used for
// TOTP secrets (lib/auth/mfa-keys.ts) and SAR alert details
// (lib/sar/payload-seal.ts), each with its own keys.
//
// Sealed form: "v1:<kid>:<ivB64>:<tagB64>:<ciphertextB64>". GCM authenticates,
// so a tampered value fails to open.

const CIPHER = "aes-256-gcm";
const KID = /^[A-Za-z0-9_-]{1,16}$/;

export interface KeySet {
  /** The kid new values are sealed with. */
  current: string;
  keys: ReadonlyMap<string, Buffer>;
}

export function keyFromHex(name: string, hex: string): Buffer {
  const key = Buffer.from(hex, "hex");
  if (!/^[0-9a-fA-F]{64}$/.test(hex) || key.length !== 32) throw new Error(`${name} must be 32 bytes (64 hex chars).`);
  return key;
}

/** Parse "kid:hex,kid:hex" from env var `name`; the first entry is current
 *  (null when empty). Throws on anything malformed. */
export function parsePackedKeys(name: string, packed: string | undefined): { current: string | null; keys: Map<string, Buffer> } {
  const keys = new Map<string, Buffer>();
  let current: string | null = null;
  for (const entry of (packed ?? "").split(",").map((e) => e.trim()).filter(Boolean)) {
    const i = entry.indexOf(":");
    const kid = i < 0 ? "" : entry.slice(0, i);
    if (!KID.test(kid)) throw new Error(`${name} entries must be kid:hex.`);
    if (keys.has(kid)) throw new Error(`${name} lists ${kid} twice.`);
    keys.set(kid, keyFromHex(`${name} ${kid}`, entry.slice(i + 1)));
    current ??= kid;
  }
  return { current, keys };
}

export function isSealed(value: string): boolean {
  return value.startsWith("v1:") && value.split(":").length === 5;
}

/** Which kid sealed a value. */
export function sealedKid(sealed: string): string {
  if (!isSealed(sealed)) throw new Error("Malformed sealed value.");
  return sealed.split(":")[1]!;
}

export function seal(set: KeySet, plaintext: string): string {
  const key = set.keys.get(set.current);
  if (!key) throw new Error(`Key ${set.current} is missing.`);
  const iv = randomBytes(12);
  const cipher = createCipheriv(CIPHER, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", set.current, iv.toString("base64"), cipher.getAuthTag().toString("base64"), enc.toString("base64")].join(":");
}

export function open(set: KeySet, sealed: string): string {
  const kid = sealedKid(sealed);
  const [, , ivB64, tagB64, encB64] = sealed.split(":");
  const key = set.keys.get(kid);
  if (!key) throw new Error(`Key ${kid} is not configured; it's still needed to read some values.`);
  const decipher = createDecipheriv(CIPHER, key, Buffer.from(ivB64!, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64!, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encB64!, "base64")), decipher.final()]).toString("utf8");
}
