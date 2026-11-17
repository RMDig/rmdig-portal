"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { recordAgeConfirmation } from "@/lib/auth/age-gate";
import { safeReturnTo } from "@/lib/auth/return-to";
import { logger } from "@/lib/logger";

export type ConfirmAgeState = { ok: false; error: string } | null;

const confirmSchema = z.object({ ageConfirmed: z.literal("on") });

export async function confirmAgeAction(_prev: ConfirmAgeState, formData: FormData): Promise<ConfirmAgeState> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "Your session ended. Sign in again." };

  if (!confirmSchema.safeParse({ ageConfirmed: formData.get("ageConfirmed") }).success) {
    return { ok: false, error: "Tick the box to confirm you're 18 or older." };
  }

  let recorded: boolean;
  try {
    recorded = await recordAgeConfirmation(userId);
  } catch (err) {
    logger.error({ event: "age.confirm_failed", userId, err });
    return { ok: false, error: "We couldn't save that. Try again in a moment." };
  }
  if (!recorded) {
    // A session for a user row that's gone (deleted mid-session).
    logger.error({ event: "age.confirm_no_user", userId });
    return { ok: false, error: "Your session ended. Sign in again." };
  }
  logger.info({ event: "age.confirmed", userId });
  redirect(safeReturnTo(formData.get("next")) ?? "/dashboard");
}
