import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { users, webauthnCredentials } from "../db/schema";
import { logger } from "../logger";
import { reportProblem } from "../report-error";
import { consumeChallenge, issueChallenge, type ChallengePurpose } from "./webauthn-challenge";
import { currentRelyingParty, RP_NAME } from "./webauthn-config";

const transportsOf = (stored: string | null): AuthenticatorTransport[] =>
  (stored?.split(",").filter(Boolean) ?? []) as AuthenticatorTransport[];

// Passkeys as a second factor beside TOTP (plan 36 §5.4, S-D5: SimpleWebAuthn,
// not Auth.js's experimental provider). Discoverable credentials with user
// verification required: at sign-in the browser offers the passkey without the
// portal naming which passkeys an email has, and the device asks for its own
// PIN or biometric, so one passkey is "something you have" plus "something you
// are or know".

export interface PasskeySummary {
  id: string;
  nickname: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export async function listPasskeys(userId: string): Promise<PasskeySummary[]> {
  const rows = await db
    .select({
      id: webauthnCredentials.id,
      nickname: webauthnCredentials.nickname,
      createdAt: webauthnCredentials.createdAt,
      lastUsedAt: webauthnCredentials.lastUsedAt,
    })
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.userId, userId));
  return rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/** When a passkey was enrolled, for the revoke's authStrength (rev 2 §3.3). */
export async function passkeyCreatedAt(passkeyId: string): Promise<Date | null> {
  const [row] = await db
    .select({ createdAt: webauthnCredentials.createdAt })
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.id, passkeyId))
    .limit(1);
  return row?.createdAt ?? null;
}

export async function registrationOptions(user: {
  id: string;
  email: string;
  name: string | null;
}): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const rp = await currentRelyingParty();
  const existing = await db
    .select({ credentialId: webauthnCredentials.credentialId, transports: webauthnCredentials.transports })
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.userId, user.id));
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp.rpID,
    userName: user.email,
    userDisplayName: user.name ?? user.email,
    // The portal user id, so the same person's passkeys share a user handle.
    userID: isoBase64URL.toBuffer(isoBase64URL.fromUTF8String(user.id)),
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({ id: c.credentialId, transports: transportsOf(c.transports) })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  await issueChallenge(options.challenge, "register", user.id);
  return options;
}

export type RegistrationResult = { ok: true; passkeyId: string } | { ok: false; error: string };

export async function finishRegistration(
  userId: string,
  response: RegistrationResponseJSON,
  nickname: string,
): Promise<RegistrationResult> {
  const challenge = await consumeChallenge("register", userId);
  if (!challenge) return { ok: false, error: "That took too long. Try adding the passkey again." };
  const rp = await currentRelyingParty();
  let verified;
  try {
    verified = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
    });
  } catch (err) {
    logger.warn({ event: "passkeys.register.invalid", userId, err });
    return { ok: false, error: "Your device's answer couldn't be checked. Try again." };
  }
  if (!verified.verified) return { ok: false, error: "Your device's answer couldn't be checked. Try again." };
  const { credential } = verified.registrationInfo;
  const [row] = await db
    .insert(webauthnCredentials)
    .values({
      userId,
      credentialId: credential.id,
      publicKey: isoBase64URL.fromBuffer(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports?.join(",") ?? null,
      nickname,
    })
    .returning({ id: webauthnCredentials.id });
  if (!row) throw new Error("passkey insert returned no row");
  return { ok: true, passkeyId: row.id };
}

/** Options for a passkey second factor: no allowCredentials, so nothing about
 *  an account is revealed; the browser offers this site's discoverable passkeys. */
export async function authenticationOptions(
  purpose: Extract<ChallengePurpose, "signin" | "reauth">,
  userId: string | null,
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const rp = await currentRelyingParty();
  const options = await generateAuthenticationOptions({ rpID: rp.rpID, userVerification: "required" });
  await issueChallenge(options.challenge, purpose, userId);
  return options;
}

export type AssertionResult = { ok: true; passkeyId: string } | { ok: false };

/** Check a passkey answer for `userId`: the passkey must be theirs, the
 *  challenge this ceremony's, the device must have verified the person, and
 *  the signature counter must not go backwards (a cloned authenticator). */
export async function verifyPasskeyAssertion(
  userId: string,
  rawResponse: string,
  purpose: Extract<ChallengePurpose, "signin" | "reauth">,
): Promise<AssertionResult> {
  const challenge = await consumeChallenge(purpose, purpose === "reauth" ? userId : null);
  if (!challenge) return { ok: false };
  let response: AuthenticationResponseJSON;
  try {
    response = JSON.parse(rawResponse) as AuthenticationResponseJSON;
  } catch {
    // Malformed client input, not an error of ours: it simply isn't a passkey.
    return { ok: false };
  }
  const [cred] = await db
    .select()
    .from(webauthnCredentials)
    .where(and(eq(webauthnCredentials.credentialId, String(response.id ?? "")), eq(webauthnCredentials.userId, userId)))
    .limit(1);
  if (!cred) {
    logger.info({ event: "passkeys.assert.not_this_users", userId });
    return { ok: false };
  }
  const rp = await currentRelyingParty();
  try {
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
      credential: {
        id: cred.credentialId,
        publicKey: isoBase64URL.toBuffer(cred.publicKey),
        counter: cred.counter,
        transports: transportsOf(cred.transports),
      },
    });
    if (!result.verified) return { ok: false };
    await db
      .update(webauthnCredentials)
      .set({ counter: result.authenticationInfo.newCounter, lastUsedAt: new Date() })
      .where(eq(webauthnCredentials.id, cred.id));
    return { ok: true, passkeyId: cred.id };
  } catch (err) {
    // SimpleWebAuthn throws on a counter that didn't go up (a cloned key) as
    // well as on a bad signature: either way it's refused, and a regression
    // is worth a look.
    const message = err instanceof Error ? err.message : String(err);
    if (/counter/i.test(message)) {
      reportProblem("passkeys.assert.counter_regression", "A passkey's signature counter went backwards", { userId, passkeyId: cred.id });
    } else {
      logger.info({ event: "passkeys.assert.invalid", userId });
    }
    return { ok: false };
  }
}

type Executor = Pick<typeof db, "delete">;

/** Remove one of `userId`'s passkeys. False when it isn't theirs. */
export async function removePasskey(executor: Executor, userId: string, passkeyId: string): Promise<boolean> {
  const deleted = await executor
    .delete(webauthnCredentials)
    .where(and(eq(webauthnCredentials.userId, userId), eq(webauthnCredentials.id, passkeyId)))
    .returning({ id: webauthnCredentials.id });
  return deleted.length > 0;
}

/** Every passkey of `userId`: when two-factor is turned off. */
export async function removeAllPasskeys(executor: Executor, userId: string): Promise<number> {
  const deleted = await executor
    .delete(webauthnCredentials)
    .where(eq(webauthnCredentials.userId, userId))
    .returning({ id: webauthnCredentials.id });
  return deleted.length;
}

/** Whether two-factor is on, the precondition for adding a passkey. */
export async function mfaIsOn(userId: string): Promise<boolean> {
  const [u] = await db.select({ at: users.mfaEnabledAt }).from(users).where(eq(users.id, userId)).limit(1);
  return !!u?.at;
}
