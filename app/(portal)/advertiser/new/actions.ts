"use server";

import { eq } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { advertiserAccounts, advertiserMemberships, users } from "@/lib/db/schema";
import { createAdvertiserAccountSchema } from "@/lib/advertiser/schema";
import { logger } from "@/lib/logger";

// Server action behind /advertiser/new (docs/plans/30 §3). A signed-in,
// email-verified user creates an advertiser account: it persists as an `active`
// advertiser_accounts row and makes the creator the `admin`. Unlike SAR orgs there
// is no submit→approval machine on the account itself — an advertiser is vetted by
// the operator out of band, and the safety-critical gate lives on each creative
// (manual approval, AD-P5), not the account. So nothing this account does reaches
// users without per-creative operator approval. The (portal) layout gates auth/MFA;
// this action re-checks auth + verification because a layout must never be trusted
// to gate a write.

export type CreateAdvertiserResult =
  | { ok: true; advertiserId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

export async function createAdvertiserAccountAction(
  _prev: CreateAdvertiserResult | null,
  formData: FormData,
): Promise<CreateAdvertiserResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in to create an advertiser account." };
  }
  const userId = session.user.id;

  // Email verification is required before any state-changing action. Read it fresh
  // rather than trusting the session token.
  const [account] = await db
    .select({ emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!account) {
    return { ok: false, error: "Your account could not be found. Sign in again." };
  }
  if (!account.emailVerified) {
    return {
      ok: false,
      error: "Verify your email address before creating an advertiser account.",
    };
  }

  const parsed = createAdvertiserAccountSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  // Persist atomically: the account and the creator's admin membership either both
  // land or neither does.
  let advertiserId: string;
  try {
    advertiserId = await db.transaction(async (tx) => {
      const [adv] = await tx
        .insert(advertiserAccounts)
        .values({
          name: data.name,
          contactName: data.contactName,
          contactEmail: data.contactEmail,
          contactPhone: data.contactPhone,
          websiteUrl: data.websiteUrl,
          createdByUserId: userId,
        })
        .returning({ id: advertiserAccounts.id });
      if (!adv) {
        throw new Error("advertiser_accounts insert returned no row");
      }
      await tx
        .insert(advertiserMemberships)
        .values({ advertiserId: adv.id, userId, role: "admin" });
      return adv.id;
    });
  } catch (err) {
    logger.error({ event: "advertiser.create.tx_failed", userId, err });
    return { ok: false, error: "Couldn't create the advertiser account. Try again in a moment." };
  }

  logger.info({ event: "advertiser.create.success", userId, advertiserId });
  return { ok: true, advertiserId };
}
