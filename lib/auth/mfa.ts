import { createHash, randomBytes } from "node:crypto";

import { generateSecret, generateURI, verify } from "otplib";

import { env } from "../env";
import { decryptWith, encryptWith, parseMfaKeys, type MfaKeySet } from "./mfa-keys";

// MFA primitives — TOTP secrets, their at-rest encryption, and recovery codes.
// Pure crypto + otplib only (no DB); the DB-touching second-factor check lives
// in mfa-verify.ts. Server-only: this module reads the encryption keys.

const ISSUER = "rmdig";

// ---- TOTP secret encryption (AES-256-GCM, with a key id: lib/auth/mfa-keys.ts) ----

let keySet: MfaKeySet | null = null;

function keys(): MfaKeySet {
  keySet ??= parseMfaKeys(env.MFA_ENCRYPTION_KEYS, env.MFA_ENCRYPTION_KEY);
  return keySet;
}

export function encryptSecret(plaintext: string): string {
  return encryptWith(keys(), plaintext);
}

export function decryptSecret(stored: string): string {
  return decryptWith(keys(), stored);
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
 *  clock skew. Returns the time step it matched (for the replay check in
 *  mfa-verify.ts), or null for a wrong or non-6-digit code. */
export async function verifyTotpStep(secret: string, token: string): Promise<number | null> {
  const cleaned = token.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleaned)) return null;
  const result = await verify({ secret, token: cleaned, epochTolerance: 30 });
  return result.valid && "timeStep" in result ? result.timeStep : null;
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
