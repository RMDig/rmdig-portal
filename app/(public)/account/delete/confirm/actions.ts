"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { confirmDeletionRequest } from "@/lib/deletion/requests";
import { notifyDeletionConfirmed } from "@/lib/deletion/notify";
import { hashDeletionToken } from "@/lib/legal/deletion-tokens";
import { logger } from "@/lib/logger";
import { incrementRateLimit } from "@/lib/rate-limit";

export type ConfirmDeletionState = { ok: false; error: string } | null;

const confirmSchema = z.object({
  token: z.string().min(1).max(200),
  email: z.string().trim().max(254),
});

// Wrong addresses per link: enough for a typo or two, not for guessing.
const CONFIRM_RATE_LIMIT = { limit: 5, windowSec: 60 * 60 };

/** Confirm a deletion request from its emailed link (plan 35 §1). On success
 *  the page reloads into its confirmed state. */
export async function confirmDeletionAction(
  _prev: ConfirmDeletionState,
  formData: FormData,
): Promise<ConfirmDeletionState> {
  const parsed = confirmSchema.safeParse({ token: formData.get("token"), email: formData.get("email") });
  if (!parsed.success) return { ok: false, error: "Enter the email address you made the request for." };
  const { token, email } = parsed.data;

  const rl = await incrementRateLimit(`deletion-confirm:${hashDeletionToken(token)}`, CONFIRM_RATE_LIMIT);
  if (!rl.allowed) {
    logger.warn({ event: "deletion.confirm.rate_limited" });
    return { ok: false, error: "Too many attempts with this link. Try again in an hour." };
  }

  const result = await confirmDeletionRequest(token, email);
  switch (result.kind) {
    case "mismatch":
      logger.info({ event: "deletion.confirm.email_mismatch" });
      return { ok: false, error: "That isn't the email address this request was made for." };
    case "invalid":
      return { ok: false, error: "This link isn't valid. Submit a new deletion request to get a fresh one." };
    case "expired":
      return { ok: false, error: "This link has expired. Submit a new deletion request to get a fresh one." };
    case "confirmed":
      await notifyDeletionConfirmed(result.id, result.email, result.confirmedAt);
      break;
    case "already":
      break;
  }
  // The page shows the confirmed state for this link from now on.
  redirect(`/account/delete/confirm?token=${encodeURIComponent(token)}`);
}
