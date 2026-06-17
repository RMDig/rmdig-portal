import { render } from "@react-email/components";
import { Resend } from "resend";

import { RESET_TOKEN_TTL_MINUTES } from "../auth/reset-tokens";
import { env } from "../env";
import { logger } from "../logger";
import { INVITE_TOKEN_TTL_DAYS } from "../sar/invitations";
import AdvertiserInviteEmail from "./templates/AdvertiserInviteEmail";
import OrgInviteEmail from "./templates/OrgInviteEmail";
import ResetPasswordEmail from "./templates/ResetPasswordEmail";
import SarOrgDecisionEmail, { type SarOrgDecision } from "./templates/SarOrgDecisionEmail";
import SarOrgPendingReviewEmail from "./templates/SarOrgPendingReviewEmail";
import SarOrgSubmittedEmail from "./templates/SarOrgSubmittedEmail";
import VerifyEmail from "./templates/VerifyEmail";

const resend = new Resend(env.RESEND_API_KEY);

const VERIFY_EMAIL_EXPIRES_HOURS = 24;

export async function sendVerificationEmail(to: string, verifyUrl: string): Promise<void> {
  const html = await render(
    VerifyEmail({ verifyUrl, expiresInHours: VERIFY_EMAIL_EXPIRES_HOURS }),
  );

  const { data, error } = await resend.emails.send({
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

  const { data, error } = await resend.emails.send({
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

  const { data, error } = await resend.emails.send({
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

  const { data, error } = await resend.emails.send({
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

  const { data, error } = await resend.emails.send({
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

  const { data, error } = await resend.emails.send({
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

  const { data, error } = await resend.emails.send({
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
