import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";

import { db } from "@/lib/db";
import { deletionRequests, userPlatformRoles, users } from "@/lib/db/schema";
import {
  sendDataDeletionAdminEmail,
  sendDataDeletionReceivedEmail,
} from "@/lib/email/send";
import { hashDeletionToken } from "@/lib/legal/deletion-tokens";
import { logger } from "@/lib/logger";
import { CPA_DAYS } from "@/lib/deletion/share-log";
import { portalUrl } from "@/lib/email/links";

export const metadata: Metadata = {
  title: "Confirm deletion request — rmdig / AvAI",
};

export const dynamic = "force-dynamic";

// Landing page for the emailed confirmation link. Clicking proves control of
// the address (same trust model as /api/verify for email verification), which
// is the CPA request-authentication step. Confirming is idempotent: revisits
// and mail-scanner prefetches of an already-confirmed link just re-render the
// success state.
export default async function ConfirmDeletionPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token) {
    return <Invalid />;
  }

  const tokenHash = hashDeletionToken(token);
  const [request] = await db
    .select()
    .from(deletionRequests)
    .where(eq(deletionRequests.tokenHash, tokenHash))
    .limit(1);

  if (!request) {
    return <Invalid />;
  }

  if (request.status !== "pending_confirmation") {
    // Already confirmed (or even completed) — show success, don't re-notify.
    return <Confirmed requestId={request.id} />;
  }

  if (request.tokenExpiresAt < new Date()) {
    return <Expired />;
  }

  const confirmedAt = new Date();
  // Guard on status in the WHERE so two concurrent clicks can't double-confirm
  // (and double-email the operator): only one update transitions the row.
  const updated = await db
    .update(deletionRequests)
    .set({ status: "confirmed", confirmedAt })
    .where(
      and(
        eq(deletionRequests.id, request.id),
        eq(deletionRequests.status, "pending_confirmation"),
      ),
    )
    .returning({ id: deletionRequests.id });

  if (updated.length > 0) {
    // Notify outside the state transition: the row is the source of truth, so
    // an email hiccup must not un-confirm the request. Failures are logged
    // loudly, never swallowed (mirrors the SAR submission pattern).
    await notifyOnConfirmation(request.id, request.email, confirmedAt);
  }

  return <Confirmed requestId={request.id} />;
}

async function notifyOnConfirmation(
  requestId: string,
  email: string,
  confirmedAt: Date,
): Promise<void> {
  try {
    await sendDataDeletionReceivedEmail(email, { requestId });
  } catch (err) {
    logger.error({ event: "deletion.confirm.requester_email_failed", requestId, err });
  }

  let admins: { email: string }[];
  try {
    admins = await db
      .select({ email: users.email })
      .from(userPlatformRoles)
      .innerJoin(users, eq(users.id, userPlatformRoles.userId))
      .where(eq(userPlatformRoles.role, "rmdig_admin"));
  } catch (err) {
    logger.error({ event: "deletion.confirm.admin_lookup_failed", requestId, err });
    return;
  }

  for (const admin of admins) {
    try {
      await sendDataDeletionAdminEmail(admin.email, {
        requesterEmail: email,
        requestId,
        confirmedAtIso: confirmedAt.toISOString(),
        dueIso: new Date(confirmedAt.getTime() + CPA_DAYS * 86_400_000).toISOString(),
        queueUrl: portalUrl("/admin/deletion-requests"),
      });
    } catch (err) {
      logger.error({
        event: "deletion.confirm.admin_email_failed",
        requestId,
        to: admin.email,
        err,
      });
    }
  }

  logger.info({ event: "deletion.confirm.success", requestId });
}

function Confirmed({ requestId }: { requestId: string }) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Deletion request confirmed</h1>
      <div className="mt-6 space-y-4 leading-7 text-neutral-700 dark:text-neutral-200">
        <p>
          Your data-deletion request is confirmed and in our fulfillment queue. We&apos;ll
          complete it and reply to your email within 45 days, as the Colorado Privacy Act
          requires. You&apos;ll also find a confirmation in your inbox.
        </p>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Request reference: {requestId}</p>
      </div>
    </article>
  );
}

function Expired() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">This link has expired</h1>
      <p className="mt-6 leading-7 text-neutral-700 dark:text-neutral-200">
        Confirmation links are valid for 24 hours.{" "}
        <Link href="/account/delete" className="font-medium underline">
          Submit a new deletion request
        </Link>{" "}
        and we&apos;ll send a fresh one.
      </p>
    </article>
  );
}

function Invalid() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Invalid confirmation link</h1>
      <p className="mt-6 leading-7 text-neutral-700 dark:text-neutral-200">
        This link isn&apos;t valid — it may have been truncated by your email client.{" "}
        <Link href="/account/delete" className="font-medium underline">
          Submit a new deletion request
        </Link>{" "}
        to get a fresh one.
      </p>
    </article>
  );
}
