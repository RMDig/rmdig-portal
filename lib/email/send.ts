import { render } from "@react-email/components";
import { Resend } from "resend";

import { RESET_TOKEN_TTL_MINUTES } from "../auth/reset-tokens";
import { env } from "../env";
import { logger } from "../logger";
import { INVITE_TOKEN_TTL_DAYS } from "../sar/invitations";
import AdCreativeDecisionEmail, {
  type AdCreativeDecision,
} from "./templates/AdCreativeDecisionEmail";
import AdCreativePendingReviewEmail from "./templates/AdCreativePendingReviewEmail";
import AdvertiserInviteEmail from "./templates/AdvertiserInviteEmail";
import DataDeletionAdminEmail from "./templates/DataDeletionAdminEmail";
import DataDeletionConfirmEmail from "./templates/DataDeletionConfirmEmail";
import DataDeletionReceivedEmail from "./templates/DataDeletionReceivedEmail";
import OrgInviteEmail from "./templates/OrgInviteEmail";
import ResetPasswordEmail from "./templates/ResetPasswordEmail";
import SarOrgDecisionEmail, { type SarOrgDecision } from "./templates/SarOrgDecisionEmail";
import SarOrgPendingReviewEmail from "./templates/SarOrgPendingReviewEmail";
import SarOrgSubmittedEmail from "./templates/SarOrgSubmittedEmail";
import VerifyEmail from "./templates/VerifyEmail";

// Lazy so importing this module never depends on the key being present —
// RESEND_API_KEY is optional in the env schema (a deploy without it must still
// serve pages). Actually sending without the key fails loud, per house rules.
let resendClient: Resend | null = null;
function getResend(): Resend {
  if (!env.RESEND_API_KEY) {
    throw new Error(
      "RESEND_API_KEY is not set — transactional email is unconfigured in this environment",
    );
  }
  resendClient ??= new Resend(env.RESEND_API_KEY);
  return resendClient;
}

const VERIFY_EMAIL_EXPIRES_HOURS = 24;

export async function sendVerificationEmail(to: string, verifyUrl: string): Promise<void> {
  const html = await render(
    VerifyEmail({ verifyUrl, expiresInHours: VERIFY_EMAIL_EXPIRES_HOURS }),
  );

  const { data, error } = await getResend().emails.send({
    from: `rmdig <${env.RESEND_FROM_EMAIL}>`,
    to,
    subject: "Verify your email",
    html,
  });

  if (error) {
    logger.error({ event: "email.verification.failed", to, error });
    throw new Error(`Resend rejected verification email: ${error.message}`);
  }

  logger.info({ event: "email.verification.sent", to, resendId: data?.id });
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const html = await render(
    ResetPasswordEmail({ resetUrl, expiresInMinutes: RESET_TOKEN_TTL_MINUTES }),
  );

  const { data, error } = await getResend().emails.send({
    from: `rmdig <${env.RESEND_FROM_EMAIL}>`,
    to,
    subject: "Reset your password",
    html,
  });

  if (error) {
    logger.error({ event: "email.password_reset.failed", to, error });
    throw new Error(`Resend rejected password-reset email: ${error.message}`);
  }

  logger.info({ event: "email.password_reset.sent", to, resendId: data?.id });
}

export async function sendSarOrgSubmittedEmail(to: string, orgName: string): Promise<void> {
  const html = await render(SarOrgSubmittedEmail({ orgName }));

  const { data, error } = await getResend().emails.send({
    from: `rmdig <${env.RESEND_FROM_EMAIL}>`,
    to,
    subject: "We received your SAR organization application",
    html,
  });

  if (error) {
    logger.error({ event: "email.sar_submitted.failed", to, error });
    throw new Error(`Resend rejected SAR-submitted email: ${error.message}`);
  }

  logger.info({ event: "email.sar_submitted.sent", to, resendId: data?.id });
}

export async function sendSarOrgPendingReviewEmail(
  to: string,
  params: { orgName: string; submitterEmail: string; reviewUrl: string },
): Promise<void> {
  const html = await render(SarOrgPendingReviewEmail(params));

  const { data, error } = await getResend().emails.send({
    from: `rmdig <${env.RESEND_FROM_EMAIL}>`,
    to,
    subject: `SAR org awaiting review: ${params.orgName}`,
    html,
  });

  if (error) {
    logger.error({ event: "email.sar_pending_review.failed", to, error });
    throw new Error(`Resend rejected SAR-pending-review email: ${error.message}`);
  }

  logger.info({ event: "email.sar_pending_review.sent", to, resendId: data?.id });
}

const DECISION_SUBJECT: Record<SarOrgDecision, string> = {
  approved: "Your SAR organization is approved",
  rejected: "An update on your SAR organization application",
  changes_requested: "Your SAR organization application needs changes",
};

export async function sendSarOrgDecisionEmail(
  to: string,
  params: { orgName: string; decision: SarOrgDecision; note?: string },
): Promise<void> {
  const html = await render(SarOrgDecisionEmail(params));

  const { data, error } = await getResend().emails.send({
    from: `rmdig <${env.RESEND_FROM_EMAIL}>`,
    to,
    subject: DECISION_SUBJECT[params.decision],
    html,
  });

  if (error) {
    logger.error({ event: "email.sar_decision.failed", to, decision: params.decision, error });
    throw new Error(`Resend rejected SAR-decision email: ${error.message}`);
  }

  logger.info({ event: "email.sar_decision.sent", to, decision: params.decision, resendId: data?.id });
}

export async function sendOrgInviteEmail(
  to: string,
  params: { orgName: string; inviteUrl: string; role: string },
): Promise<void> {
  const html = await render(
    OrgInviteEmail({ ...params, expiresInDays: INVITE_TOKEN_TTL_DAYS }),
  );

  const { data, error } = await getResend().emails.send({
    from: `rmdig <${env.RESEND_FROM_EMAIL}>`,
    to,
    subject: `You're invited to join ${params.orgName} on rmdig`,
    html,
  });

  if (error) {
    logger.error({ event: "email.org_invite.failed", to, error });
    throw new Error(`Resend rejected org-invite email: ${error.message}`);
  }

  logger.info({ event: "email.org_invite.sent", to, resendId: data?.id });
}

export async function sendAdvertiserInviteEmail(
  to: string,
  params: { advertiserName: string; inviteUrl: string; role: string },
): Promise<void> {
  const html = await render(
    AdvertiserInviteEmail({ ...params, expiresInDays: INVITE_TOKEN_TTL_DAYS }),
  );

  const { data, error } = await getResend().emails.send({
    from: `rmdig <${env.RESEND_FROM_EMAIL}>`,
    to,
    subject: `You're invited to join ${params.advertiserName} on rmdig`,
    html,
  });

  if (error) {
    logger.error({ event: "email.advertiser_invite.failed", to, error });
    throw new Error(`Resend rejected advertiser-invite email: ${error.message}`);
  }

  logger.info({ event: "email.advertiser_invite.sent", to, resendId: data?.id });
}

export async function sendAdCreativePendingReviewEmail(
  to: string,
  params: { advertiserName: string; headline: string; reviewUrl: string },
): Promise<void> {
  const html = await render(AdCreativePendingReviewEmail(params));

  const { data, error } = await getResend().emails.send({
    from: `rmdig <${env.RESEND_FROM_EMAIL}>`,
    to,
    subject: `Ad creative awaiting review: ${params.headline}`,
    html,
  });

  if (error) {
    logger.error({ event: "email.ad_pending_review.failed", to, error });
    throw new Error(`Resend rejected ad-pending-review email: ${error.message}`);
  }

  logger.info({ event: "email.ad_pending_review.sent", to, resendId: data?.id });
}

const AD_DECISION_SUBJECT: Record<AdCreativeDecision, string> = {
  approved: "Your ad creative is approved",
  rejected: "An update on your ad creative",
  changes_requested: "Your ad creative needs changes",
};

export async function sendAdCreativeDecisionEmail(
  to: string,
  params: { advertiserName: string; headline: string; decision: AdCreativeDecision; note?: string },
): Promise<void> {
  const html = await render(AdCreativeDecisionEmail(params));

  const { data, error } = await getResend().emails.send({
    from: `rmdig <${env.RESEND_FROM_EMAIL}>`,
    to,
    subject: AD_DECISION_SUBJECT[params.decision],
    html,
  });

  if (error) {
    logger.error({ event: "email.ad_decision.failed", to, decision: params.decision, error });
    throw new Error(`Resend rejected ad-decision email: ${error.message}`);
  }

  logger.info({ event: "email.ad_decision.sent", to, decision: params.decision, resendId: data?.id });
}

export async function sendDataDeletionConfirmEmail(
  to: string,
  params: { confirmUrl: string; expiresInHours: number },
): Promise<void> {
  const html = await render(DataDeletionConfirmEmail(params));

  const { data, error } = await getResend().emails.send({
    from: `rmdig <${env.RESEND_FROM_EMAIL}>`,
    to,
    subject: "Confirm your data-deletion request",
    html,
  });

  if (error) {
    logger.error({ event: "email.deletion_confirm.failed", to, error });
    throw new Error(`Resend rejected deletion-confirm email: ${error.message}`);
  }

  logger.info({ event: "email.deletion_confirm.sent", to, resendId: data?.id });
}

export async function sendDataDeletionReceivedEmail(
  to: string,
  params: { requestId: string },
): Promise<void> {
  const html = await render(DataDeletionReceivedEmail(params));

  const { data, error } = await getResend().emails.send({
    from: `rmdig <${env.RESEND_FROM_EMAIL}>`,
    to,
    subject: "Your data-deletion request is confirmed",
    html,
  });

  if (error) {
    logger.error({ event: "email.deletion_received.failed", to, error });
    throw new Error(`Resend rejected deletion-received email: ${error.message}`);
  }

  logger.info({ event: "email.deletion_received.sent", to, resendId: data?.id });
}

export async function sendDataDeletionAdminEmail(
  to: string,
  params: { requesterEmail: string; requestId: string; confirmedAtIso: string },
): Promise<void> {
  const html = await render(DataDeletionAdminEmail(params));

  const { data, error } = await getResend().emails.send({
    from: `rmdig <${env.RESEND_FROM_EMAIL}>`,
    to,
    subject: "Data-deletion request awaiting fulfillment",
    html,
  });

  if (error) {
    logger.error({ event: "email.deletion_admin.failed", to, error });
    throw new Error(`Resend rejected deletion-admin email: ${error.message}`);
  }

  logger.info({ event: "email.deletion_admin.sent", to, resendId: data?.id });
}
