"use server";

import type { PublicKeyCredentialCreationOptionsJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { finishRegistration, listPasskeys, mfaIsOn, registrationOptions, removePasskey } from "@/lib/auth/passkeys";
import { portalActor } from "@/lib/auth/portal-actor";
import { requireRecentAuth } from "@/lib/auth/recent-auth";
import { recordSecurityEvent } from "@/lib/auth/security-events";
import { notifySecurityChange } from "@/lib/auth/security-notices";
import { signOutOtherSessions } from "@/lib/auth/sessions";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { logger } from "@/lib/logger";

// Adding and removing passkeys (plan 36 §5.4). Both need a recent login and
// two-factor already on: a passkey is an addition to TOTP, never a
// replacement, so recovery codes always exist if every passkey is lost.

type Failure = { ok: false; error: string; reauth?: true };
const REAUTH: Failure = { ok: false, reauth: true, error: "For your security, confirm it's you before changing passkeys." };
const MAX_PASSKEYS = 10;

async function ready(): Promise<{ ok: true; userId: string; sessionId: string } | Failure> {
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  if (!(await mfaIsOn(actor.userId))) {
    return { ok: false, error: "Turn on two-factor authentication first. A passkey is added alongside it." };
  }
  const recent = await requireRecentAuth(actor.userId);
  if (!recent.ok) return REAUTH;
  return { ok: true, userId: actor.userId, sessionId: recent.sessionId };
}

export async function passkeyRegistrationOptionsAction(): Promise<
  { ok: true; options: PublicKeyCredentialCreationOptionsJSON } | Failure
> {
  const r = await ready();
  if (!r.ok) return r;
  if ((await listPasskeys(r.userId)).length >= MAX_PASSKEYS) {
    return { ok: false, error: `You can have up to ${MAX_PASSKEYS} passkeys. Remove one first.` };
  }
  const [user] = await db
    .select({ email: users.email, name: users.displayName })
    .from(users)
    .where(eq(users.id, r.userId))
    .limit(1);
  if (!user) return { ok: false, error: "You must be signed in." };
  try {
    return { ok: true, options: await registrationOptions({ id: r.userId, email: user.email, name: user.name }) };
  } catch (err) {
    logger.error({ event: "passkeys.register_options.failed", userId: r.userId, err });
    return { ok: false, error: "Passkeys aren't available here right now." };
  }
}

const nicknameSchema = z.string().trim().min(1, "Give the passkey a name").max(60, "Keep the name under 60 characters");

export type PasskeyResult = { ok: true; message: string } | Failure | null;

export async function finishPasskeyRegistrationAction(
  response: RegistrationResponseJSON,
  rawNickname: string,
): Promise<PasskeyResult> {
  const nickname = nicknameSchema.safeParse(rawNickname);
  if (!nickname.success) return { ok: false, error: nickname.error.issues[0]?.message ?? "Give the passkey a name" };
  const r = await ready();
  if (!r.ok) return r;
  const result = await finishRegistration(r.userId, response, nickname.data);
  if (!result.ok) return { ok: false, error: result.error };
  await recordSecurityEvent(db, { userId: r.userId, kind: "passkey_added", sessionId: r.sessionId });
  logger.info({ event: "passkeys.added", userId: r.userId });
  await notifySecurityChange(r.userId);
  revalidatePath("/settings");
  return { ok: true, message: "Passkey added. It can stand in for your authenticator code." };
}

export async function removePasskeyAction(_prev: PasskeyResult, formData: FormData): Promise<PasskeyResult> {
  const id = z.string().uuid().safeParse(formData.get("passkeyId"));
  if (!id.success) return { ok: false, error: "That passkey couldn't be found." };
  const r = await ready();
  if (!r.ok) return r;
  // Removing a sign-in method signs the other browsers out (plan 36 §3.3), as
  // turning two-factor off does: one could have been opened with it.
  const removed = await db.transaction(async (tx) => {
    const done = await removePasskey(tx, r.userId, id.data);
    if (done) {
      await signOutOtherSessions(tx, r.userId, r.sessionId);
      await recordSecurityEvent(tx, { userId: r.userId, kind: "passkey_removed", sessionId: r.sessionId });
    }
    return done;
  });
  if (!removed) return { ok: false, error: "That passkey was already removed." };
  logger.info({ event: "passkeys.removed", userId: r.userId });
  await notifySecurityChange(r.userId);
  revalidatePath("/settings");
  return { ok: true, message: "Passkey removed. Your other browsers were signed out." };
}
