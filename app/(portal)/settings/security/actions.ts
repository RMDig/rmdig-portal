"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { portalActor } from "@/lib/auth/portal-actor";
import { requireRecentAuth } from "@/lib/auth/recent-auth";
import { recordSecurityEvent } from "@/lib/auth/security-events";
import { notifySecurityChange, setSecurityNotices } from "@/lib/auth/security-notices";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { logger } from "@/lib/logger";

// Turning security notices on or off (plan 36 §5.3). Both need a recent login
// and both are recorded. Turning them OFF is announced before it takes effect,
// so an owner whose login someone else holds still hears about it once.

export type NoticesResult = { ok: true; message: string } | { ok: false; error: string; reauth?: true } | null;

export async function setNoticesAction(_prev: NoticesResult, formData: FormData): Promise<NoticesResult> {
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  const userId = actor.userId;
  const on = formData.get("on") === "1";

  const recent = await requireRecentAuth(userId);
  if (!recent.ok) {
    return { ok: false, reauth: true, error: "For your security, confirm it's you before changing notices." };
  }

  const [user] = await db
    .select({ accountId: users.avservAccountId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!on) await notifySecurityChange(userId);
  await setSecurityNotices(userId, user?.accountId ?? null, on);
  await recordSecurityEvent(db, { userId, kind: on ? "notices_on" : "notices_off", sessionId: recent.sessionId });
  if (on) await notifySecurityChange(userId);

  logger.info({ event: on ? "security_notices.on" : "security_notices.off", userId });
  revalidatePath("/settings/security");
  return { ok: true, message: on ? "Security notices are on." : "Security notices are off." };
}
