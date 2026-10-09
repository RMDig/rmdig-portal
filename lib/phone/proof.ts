import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env";

// A signed note that a user verified a phone number, so an application can be
// submitted after the "Verify" step without asking Twilio again: Twilio accepts
// a code once, and the check before submit used it up. The note names the user
// and the E.164 number and expires after an hour. Nothing is stored; the
// signature (HMAC-SHA256 under a key derived from NEXTAUTH_SECRET) is what
// makes it unforgeable, and requireVerifiedOrgPhone re-checks it on submit.

const TTL_MS = 60 * 60 * 1000;
const MAC_PATTERN = /^(\d{1,15})\.([A-Za-z0-9_-]{43})$/;

function signingKey(): Buffer {
  // Derived rather than NEXTAUTH_SECRET itself, so this signature can't be
  // confused with anything Auth.js signs.
  return createHmac("sha256", env.NEXTAUTH_SECRET).update("rmdig phone-verify proof v1").digest();
}

function mac(userId: string, phoneE164: string, expiresAt: number): string {
  return createHmac("sha256", signingKey()).update(`${userId}\n${phoneE164}\n${expiresAt}`).digest("base64url");
}

export function signPhoneProof(userId: string, phoneE164: string, now = Date.now()): string {
  const expiresAt = now + TTL_MS;
  return `${expiresAt}.${mac(userId, phoneE164, expiresAt)}`;
}

/** True only for an unexpired proof issued to this user for this number. */
export function verifyPhoneProof(token: string, userId: string, phoneE164: string, now = Date.now()): boolean {
  const match = MAC_PATTERN.exec(token);
  if (!match) return false;
  const expiresAt = Number(match[1]);
  if (!(expiresAt > now)) return false;
  const given = Buffer.from(match[2] ?? "");
  const expected = Buffer.from(mac(userId, phoneE164, expiresAt));
  return given.length === expected.length && timingSafeEqual(given, expected);
}
