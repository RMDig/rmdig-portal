import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import { generateSecret, generateURI, verify } from "otplib";

import { env } from "../env";

// MFA primitives — TOTP secrets, their at-rest encryption, and recovery codes.
// Pure crypto + otplib only (no DB); the DB-touching second-factor check lives
// in mfa-verify.ts. Server-only: this module reads the encryption key.

const ISSUER = "rmdig";
const CIPHER = "aes-256-gcm";

// ---- TOTP secret encryption (AES-256-GCM) ----
//
// Stored form is "ivB64:tagB64:ciphertextB64". GCM gives us authenticated
// encryption: decrypt throws if the ciphertext or tag was tampered with.

function getKey(): Buffer {
  const hex = env.MFA_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error(
      "MFA_ENCRYPTION_KEY is not set — cannot encrypt/decrypt TOTP secrets. " +
        "Generate one with `openssl rand -hex 32` and set it in the environment.",
    );
  }
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32) {
    throw new Error("MFA_ENCRYPTION_KEY must be 32 bytes (64 hex chars).");
  }
  return key;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(CIPHER, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

export function decryptSecret(stored: string): string {
  const [ivB64, tagB64, encB64] = stored.split(":");
  if (!ivB64 || !tagB64 || !encB64) {
    throw new Error("Malformed encrypted TOTP secret.");
  }
  const decipher = createDecipheriv(CIPHER, getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

// ---- TOTP ----

export function generateTotpSecret(): string {
  return generateSecret(); // base32
}

/** otpauth:// URI for QR rendering and manual entry. */
export function totpKeyUri(email: string, secret: string): string {
  return generateURI({ issuer: ISSUER, label: email, secret });
}

/** Verify a 6-digit TOTP against the secret, tolerating ±1 time step (±30s) of
 *  clock skew. Returns false for any non-6-digit input rather than throwing. */
export async function verifyTotp(secret: string, token: string): Promise<boolean> {
  const cleaned = token.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleaned)) return false;
  const result = await verify({ secret, token: cleaned, epochTolerance: 30 });
  return result.valid;
}

// ---- Recovery codes ----

const RECOVERY_CODE_COUNT = 10;
// Crockford-ish alphabet: no 0/O/1/I to avoid transcription errors.
const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Generate N fresh recovery codes in XXXX-XXXX form (plaintext, shown once). */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(8);
    let s = "";
    for (const b of bytes) s += RECOVERY_ALPHABET.charAt(b % RECOVERY_ALPHABET.length);
    return `${s.slice(0, 4)}-${s.slice(4, 8)}`;
  });
}

/** Normalize user-entered codes (case, spaces, dashes) before hashing/compare. */
export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");
}
