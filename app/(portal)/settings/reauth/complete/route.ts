import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/lib/auth";
import { requireRecentAuth } from "@/lib/auth/recent-auth";
import { safeReturnTo } from "@/lib/auth/return-to";
import { revokeSession } from "@/lib/auth/sessions";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

// Back from Google re-authentication (reauth/actions.ts). The new session is the
// proof; the session it replaced is ended here, so the list doesn't show it.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = req.nextUrl;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.redirect(new URL("/sign-in", url));

  const recent = await requireRecentAuth(userId);
  if (!recent.ok) {
    // Google returned without a fresh sign-in (cancelled, or it didn't re-ask).
    logger.warn({ event: "auth.reauth.google_not_fresh", userId });
    return NextResponse.redirect(new URL("/settings/reauth?error=google", url));
  }

  const prev = url.searchParams.get("prev");
  if (prev && prev !== recent.sessionId && /^[0-9a-f-]{36}$/.test(prev)) {
    // Only ever this user's own session (revokeSession matches on user id).
    await revokeSession(db, userId, prev);
  }
  logger.info({ event: "auth.reauth.google", userId });
  const to = safeReturnTo(url.searchParams.get("returnTo")) ?? "/settings";
  return NextResponse.redirect(new URL(to, url));
}
