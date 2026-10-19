"use server";

import { redirect } from "next/navigation";

import { portalActor } from "@/lib/auth/portal-actor";
import { verifyPasswordReauth } from "@/lib/auth/reauth";
import { authenticationOptions } from "@/lib/auth/passkeys";
import { markRecentAuth } from "@/lib/auth/recent-auth";
import type { PasskeyOptionsResult } from "@/components/auth/PasskeyFactorButton";
import { safeReturnTo } from "@/lib/auth/return-to";
import { logger } from "@/lib/logger";

export type ReauthResult = { ok: false; error: string } | null;

function returnTo(formData: FormData): string {
  return safeReturnTo(formData.get("returnTo")) ?? "/settings";
}

export async function reauthWithPasswordAction(_prev: ReauthResult, formData: FormData): Promise<ReauthResult> {
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  const userId = actor.userId;

  const passkey = String(formData.get("passkey") ?? "");
  const check = await verifyPasswordReauth(userId, {
    password: String(formData.get("password") ?? ""),
    code: String(formData.get("code") ?? ""),
    ...(passkey ? { passkey } : {}),
  });
  if (!check.ok) return { ok: false, error: check.error };

  if (!(await markRecentAuth(userId, check.method, check.passkeyId))) {
    logger.warn({ event: "auth.reauth.no_session", userId });
    return { ok: false, error: "Your session has ended. Sign in again." };
  }
  logger.info({ event: "auth.reauth.confirmed", userId, method: check.method });
  redirect(returnTo(formData));
}

/** Passkey options for confirming it's you, bound to this user. */
export async function reauthPasskeyOptionsAction(): Promise<PasskeyOptionsResult> {
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  try {
    return { ok: true, options: await authenticationOptions("reauth", actor.userId) };
  } catch (err) {
    logger.error({ event: "passkeys.reauth_options.failed", userId: actor.userId, err });
    return { ok: false, error: "Passkeys aren't available here right now. Use your code instead." };
  }
}
