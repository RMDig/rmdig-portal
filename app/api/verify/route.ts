import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { users, verificationTokens } from "@/lib/db/schema";
import { safeReturnTo } from "@/lib/auth/return-to";
import { hashVerificationToken } from "@/lib/auth/verification-tokens";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const email = url.searchParams.get("email")?.toLowerCase();
  // Carried from sign-up so the user ends up where they were headed.
  const next = safeReturnTo(url.searchParams.get("next"));
  const nextParam = next ? `&next=${encodeURIComponent(next)}` : "";

  if (!token || !email) {
    logger.warn({ event: "verify.missing_params" });
    redirect(`/sign-in?error=invalid-link${nextParam}`);
  }

  // The table holds only SHA-256 hashes (lib/auth/verification-tokens.ts).
  const tokenHash = hashVerificationToken(token);
  const [vt] = await db
    .select()
    .from(verificationTokens)
    .where(
      and(
        eq(verificationTokens.identifier, email),
        eq(verificationTokens.token, tokenHash),
      ),
    )
    .limit(1);

  if (!vt) {
    logger.warn({ event: "verify.token_not_found", email });
    redirect(`/sign-in?error=invalid-token${nextParam}`);
  }

  if (vt.expires.getTime() < Date.now()) {
    logger.warn({ event: "verify.token_expired", email });
    redirect(`/sign-in?error=expired-token${nextParam}`);
  }

  // Mark verified and burn the token. Both in a single round-trip would be
  // nicer; correctness-first for now since this isn't a hot path.
  await db
    .update(users)
    .set({ emailVerified: new Date() })
    .where(eq(users.email, email));

  await db
    .delete(verificationTokens)
    .where(
      and(
        eq(verificationTokens.identifier, email),
        eq(verificationTokens.token, tokenHash),
      ),
    );

  logger.info({ event: "verify.success", email });
  redirect(`/sign-in?verified=true${nextParam}`);
}
