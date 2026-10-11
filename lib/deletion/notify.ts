import { eq } from "drizzle-orm";

import { db } from "../db";
import { userPlatformRoles, users } from "../db/schema";
import { portalUrl } from "../email/links";
import { sendDataDeletionAdminEmail, sendDataDeletionReceivedEmail } from "../email/send";
import { logger } from "../logger";
import { reportError, reportProblem } from "../report-error";
import { CPA_DAYS } from "./share-log";

// Who hears that a deletion request was confirmed: the requester (a receipt)
// and every rmdig admin (the CPA clock has started). Runs after the state
// change; the row is the source of truth, so a failed email never un-confirms
// a request. Failures are logged loudly, never swallowed (mirrors the SAR
// submission pattern).
export async function notifyDeletionConfirmed(
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
    // Nobody is told the CPA clock started; the deletion-clock cron still
    // flags the request at 30 days.
    reportError("deletion.confirm.admin_lookup_failed", err, { requestId });
    return;
  }
  if (admins.length === 0) {
    reportProblem("deletion.confirm.no_admins", "No rmdig admin to tell about a confirmed deletion request", { requestId });
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
      // lib/email/send has already reported it to Sentry.
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
