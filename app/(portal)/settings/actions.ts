"use server";

import { eq } from "drizzle-orm";

import { portalActor } from "@/lib/auth/portal-actor";
import { mintLinkCode } from "@/lib/avserv/client";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { incrementRateLimit } from "@/lib/rate-limit";

// A code lasts 10 minutes, so ten a day covers a fumbled link or two and a new
// phone. AvServ's own backstop is 10 per account per day per node (plan 52
// D14); this one sits in front of it (plan 36 §5.5).
const LINK_CODE_LIMIT = { limit: 10, windowSec: 24 * 60 * 60 };

// Device-link settings action (P-B2, rmdig-ai docs/plans/05). The portal MINTS a
// single-use link-code for the signed-in user's AvServ account; the user types
// it into AvApp to bind a device. AvApp consumes the code on the device tier —
// the portal only mints.

export type MintLinkCodeResult =
  | { ok: true; code: string; expiresAt: string }
  | { ok: false; error: string };

/**
 * Mint a device link-code for the current user. useActionState calls this with
 * (prevState, formData); both are ignored — the only input is the session.
 */
export async function mintDeviceLinkCodeAction(
  _prev: MintLinkCodeResult | null,
  _formData: FormData,
): Promise<MintLinkCodeResult> {
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  const userId = actor.userId;

  const [row] = await db
    .select({ avservAccountId: users.avservAccountId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row?.avservAccountId) {
    // The login-time map (P-B1) hasn't populated this yet — usually a transient
    // AvServ hiccup at last sign-in. A fresh sign-in retries the map.
    logger.warn({ event: "avserv.linkcode.no_account", userId });
    return {
      ok: false,
      error:
        "Your account isn't linked to the device service yet. Sign out and back in, then try again.",
    };
  }

  if (!(await incrementRateLimit(`linkcode:${userId}`, LINK_CODE_LIMIT)).allowed) {
    logger.warn({ event: "avserv.linkcode.rate_limited", userId });
    return { ok: false, error: "You've made 10 link codes today. Try again tomorrow." };
  }

  try {
    const { code, expiresAt } = await mintLinkCode(row.avservAccountId);
    logger.info({ event: "avserv.linkcode.minted", userId });
    return { ok: true, code, expiresAt };
  } catch (err) {
    // User-initiated, so surface the failure rather than silently retrying.
    logger.error({ event: "avserv.linkcode.failed", userId, err });
    return {
      ok: false,
      error: "Couldn't generate a link code right now. Try again in a moment.",
    };
  }
}
