"use server";

import { redirect } from "next/navigation";

import { portalActor } from "@/lib/auth/portal-actor";
import { verifyPasswordReauth } from "@/lib/auth/reauth";
import { markRecentAuth } from "@/lib/auth/recent-auth";
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

  const error = await verifyPasswordReauth(userId, {
    password: String(formData.get("password") ?? ""),
    code: String(formData.get("code") ?? ""),
  });
  if (error) return { ok: false, error };

  if (!(await markRecentAuth(userId))) {
    logger.warn({ event: "auth.reauth.no_session", userId });
    return { ok: false, error: "Your session has ended. Sign in again." };
  }
  logger.info({ event: "auth.reauth.password", userId });
  redirect(returnTo(formData));
}
