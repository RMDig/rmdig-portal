"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { portalActor } from "@/lib/auth/portal-actor";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { logger } from "@/lib/logger";

export type DismissResult = { ok: true } | { ok: false; error: string };

// The owner has read the notice that a Google sign-in removed a password from
// their unverified account (lib/auth/oauth-link.ts); stop showing it.
export async function dismissPasswordClearedNoticeAction(): Promise<DismissResult> {
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  await db.update(users).set({ oauthPasswordClearedAt: null }).where(eq(users.id, actor.userId));
  logger.info({ event: "auth.oauth_link.notice_dismissed", userId: actor.userId });
  revalidatePath("/dashboard");
  return { ok: true };
}
