"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { portalActor } from "@/lib/auth/portal-actor";
import { requireRecentAuth } from "@/lib/auth/recent-auth";
import { recordSecurityEvent } from "@/lib/auth/security-events";
import { notifySecurityChange } from "@/lib/auth/security-notices";
import { revokeOtherSessions, revokeSession } from "@/lib/auth/sessions";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

// Signing other browsers out (plan 36 §3.3). Both need a recent login: an
// abuser holding a signed-in browser must not be able to sign the owner out
// of theirs (rule 1, S-D2). Signing THIS browser out is the ordinary Sign out.

export type SessionActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string; reauth?: true }
  | null;

const REAUTH: SessionActionResult = {
  ok: false,
  reauth: true,
  error: "For your security, confirm it's you before signing other browsers out.",
};

const sessionIdSchema = z.string().uuid();

export async function revokeSessionAction(
  _prev: SessionActionResult,
  formData: FormData,
): Promise<SessionActionResult> {
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  const userId = actor.userId;

  const parsed = sessionIdSchema.safeParse(formData.get("sessionId"));
  if (!parsed.success) return { ok: false, error: "That session couldn't be found." };
  const target = parsed.data;

  const recent = await requireRecentAuth(userId);
  if (!recent.ok) return REAUTH;
  if (target === recent.sessionId) {
    return { ok: false, error: "That's this browser. Use Sign out instead." };
  }

  const revoked = await db.transaction(async (tx) => {
    const done = await revokeSession(tx, userId, target);
    if (done) await recordSecurityEvent(tx, { userId, kind: "session_revoked", sessionId: recent.sessionId });
    return done;
  });
  if (!revoked) return { ok: false, error: "That session has already ended." };

  logger.info({ event: "sessions.revoked_one", userId });
  await notifySecurityChange(userId);
  revalidatePath("/settings/sessions");
  return { ok: true, message: "Signed out." };
}

export async function revokeOtherSessionsAction(
  _prev: SessionActionResult,
  _formData: FormData,
): Promise<SessionActionResult> {
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  const userId = actor.userId;

  const recent = await requireRecentAuth(userId);
  if (!recent.ok) return REAUTH;

  const count = await db.transaction(async (tx) => {
    const n = await revokeOtherSessions(tx, userId, recent.sessionId);
    if (n > 0) {
      await recordSecurityEvent(tx, { userId, kind: "sessions_revoked_others", sessionId: recent.sessionId });
    }
    return n;
  });

  logger.info({ event: "sessions.revoked_others", userId, count });
  if (count > 0) await notifySecurityChange(userId);
  revalidatePath("/settings/sessions");
  return {
    ok: true,
    message: count === 0 ? "No other browsers were signed in." : `Signed out ${count} other ${count === 1 ? "browser" : "browsers"}.`,
  };
}
