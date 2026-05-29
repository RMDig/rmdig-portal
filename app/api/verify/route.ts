import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { users, verificationTokens } from "@/lib/db/schema";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const email = url.searchParams.get("email")?.toLowerCase();

  if (!token || !email) {
    logger.warn({ event: "verify.missing_params" });
    redirect("/sign-in?error=invalid-link");
  }

  const [vt] = await db
    .select()
    .from(verificationTokens)
    .where(
      and(
        eq(verificationTokens.identifier, email),
        eq(verificationTokens.token, token),
      ),
    )
    .limit(1);

  if (!vt) {
    logger.warn({ event: "verify.token_not_found", email });
    redirect("/sign-in?error=invalid-token");
  }

  if (vt.expires.getTime() < Date.now()) {
    logger.warn({ event: "verify.token_expired", email });
    redirect("/sign-in?error=expired-token");
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
        eq(verificationTokens.token, token),
      ),
    );

  logger.info({ event: "verify.success", email });
  redirect("/sign-in?verified=true");
}
