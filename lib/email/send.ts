import { render } from "@react-email/components";
import { Resend } from "resend";

import { RESET_TOKEN_TTL_MINUTES } from "../auth/reset-tokens";
import { env } from "../env";
import { logger } from "../logger";
import { shouldDeliverEmail } from "../preview-guard";
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
import PatrolReverifyStaffEmail, { type PatrolReverifyStaffEmailProps } from "./templates/PatrolReverifyStaffEmail";
import PatrolReverifyTeamEmail, { type PatrolReverifyTeamEmailProps } from "./templates/PatrolReverifyTeamEmail";
import PlatformInviteEmail from "./templates/PlatformInviteEmail";
import ResetPasswordEmail from "./templates/ResetPasswordEmail";
import RestrictionReviewRequestedEmail from "./templates/RestrictionReviewRequestedEmail";
import RestrictionReviewUpheldEmail from "./templates/RestrictionReviewUpheldEmail";
import SarOrgDecisionEmail, { type SarOrgDecision } from "./templates/SarOrgDecisionEmail";
import SarOrgPendingReviewEmail from "./templates/SarOrgPendingReviewEmail";
import SarAlertNotifyEmail, { type SarAlertNotifyKind } from "./templates/SarAlertNotifyEmail";
import SarOrgSubmittedEmail from "./templates/SarOrgSubmittedEmail";
import SarTermsDecisionEmail, { type SarTermsDecision } from "./templates/SarTermsDecisionEmail";
import SarTermsPendingReviewEmail from "./templates/SarTermsPendingReviewEmail";
import VerifyEmail from "./templates/VerifyEmail";
import type { AdvertiserRole, TeamRole } from "../labels";

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

// Every send goes through here. On a Vercel preview an email is logged, not
// sent, unless all its recipients are on PREVIEW_EMAIL_RECIPIENTS: previews
// exercise the flows without mailing anyone by accident, and a listed tester
// can still receive a new template end to end (runbook "Preview deployments").
// The body is never logged; it can carry a sign-in or deletion token.
async function deliver(m: {
  kind: string;
  label: string;
  to: string;
  subject: string;
  html: string;
  log?: Record<string, unknown>;
}): Promise<void> {
  if (!shouldDeliverEmail(env.VERCEL_ENV, env.PREVIEW_EMAIL_RECIPIENTS, m.to)) {
    logger.info({ event: `email.${m.kind}.preview_logged`, to: m.to, subject: m.subject, ...m.log });
    return;
  }

  const { data, error } = await getResend().emails.send({
    from: `rmdig <${env.RESEND_FROM_EMAIL}>`,
    to: m.to,
    subject: m.subject,
    html: m.html,
  });

  if (error) {
    logger.error({ event: `email.${m.kind}.failed`, to: m.to, ...m.log, error });
    throw new Error(`Resend rejected ${m.label} email: ${error.message}`);
  }

  logger.info({ event: `email.${m.kind}.sent`, to: m.to, ...m.log, resendId: data?.id });
}

const VERIFY_EMAIL_EXPIRES_HOURS = 24;

export async function sendVerificationEmail(to: string, verifyUrl: string): Promise<void> {
  const html = await render(
    VerifyEmail({ verifyUrl, expiresInHours: VERIFY_EMAIL_EXPIRES_HOURS }),
  );

  await deliver({
    kind: "verification",
    label: "verification",
    to,
    subject: "Verify your email",
    html,
  });
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const html = await render(
    ResetPasswordEmail({ resetUrl, expiresInMinutes: RESET_TOKEN_TTL_MINUTES }),
  );

  await deliver({
    kind: "password_reset",
    label: "password-reset",
    to,
    subject: "Reset your password",
    html,
  });
}

export async function sendSarOrgSubmittedEmail(to: string, orgName: string, statusUrl: string): Promise<void> {
  const html = await render(SarOrgSubmittedEmail({ orgName, statusUrl }));

  await deliver({
    kind: "sar_submitted",
    label: "SAR-submitted",
    to,
    subject: "We received your SAR organization application",
    html,
  });
}

export async function sendSarOrgPendingReviewEmail(
  to: string,
  params: { orgName: string; submitterEmail: string; reviewUrl: string },
): Promise<void> {
  const html = await render(SarOrgPendingReviewEmail(params));

  await deliver({
    kind: "sar_pending_review",
    label: "SAR-pending-review",
    to,
    subject: `SAR org awaiting review: ${params.orgName}`,
    html,
  });
}

const DECISION_SUBJECT: Record<SarOrgDecision, string> = {
  approved: "Your SAR organization is approved",
  rejected: "An update on your SAR organization application",
  changes_requested: "Your SAR organization application needs changes",
};

export async function sendSarOrgDecisionEmail(
  to: string,
  params: { orgName: string; decision: SarOrgDecision; note?: string; actionUrl?: string },
): Promise<void> {
  const html = await render(SarOrgDecisionEmail(params));

  await deliver({
    kind: "sar_decision",
    label: "SAR-decision",
    to,
    subject: DECISION_SUBJECT[params.decision],
    html,
    log: { decision: params.decision },
  });
}

export async function sendOrgInviteEmail(
  to: string,
  params: { orgName: string; inviteUrl: string; role: TeamRole },
): Promise<void> {
  const html = await render(
    OrgInviteEmail({ ...params, expiresInDays: INVITE_TOKEN_TTL_DAYS }),
  );

  await deliver({
    kind: "org_invite",
    label: "org-invite",
    to,
    subject: `You're invited to join ${params.orgName} on rmdig`,
    html,
  });
}

export async function sendAdvertiserInviteEmail(
  to: string,
  params: { advertiserName: string; inviteUrl: string; role: AdvertiserRole },
): Promise<void> {
  const html = await render(
    AdvertiserInviteEmail({ ...params, expiresInDays: INVITE_TOKEN_TTL_DAYS }),
  );

  await deliver({
    kind: "advertiser_invite",
    label: "advertiser-invite",
    to,
    subject: `You're invited to join ${params.advertiserName} on rmdig`,
    html,
  });
}

export async function sendAdCreativePendingReviewEmail(
  to: string,
  params: { advertiserName: string; headline: string; reviewUrl: string },
): Promise<void> {
  const html = await render(AdCreativePendingReviewEmail(params));

  await deliver({
    kind: "ad_pending_review",
    label: "ad-pending-review",
    to,
    subject: `Ad awaiting review: ${params.headline}`,
    html,
  });
}

const AD_DECISION_SUBJECT: Record<AdCreativeDecision, string> = {
  approved: "Your ad is approved",
  rejected: "An update on your ad",
  changes_requested: "Your ad needs changes",
  suspended: "Your ad is paused",
};

export async function sendAdCreativeDecisionEmail(
  to: string,
  params: { advertiserName: string; headline: string; decision: AdCreativeDecision; note?: string; creativeUrl: string; published?: boolean },
): Promise<void> {
  const html = await render(AdCreativeDecisionEmail(params));

  await deliver({
    kind: "ad_decision",
    label: "ad-decision",
    to,
    subject: AD_DECISION_SUBJECT[params.decision],
    html,
    log: { decision: params.decision },
  });
}

export async function sendDataDeletionConfirmEmail(
  to: string,
  params: { confirmUrl: string; expiresInHours: number },
): Promise<void> {
  const html = await render(DataDeletionConfirmEmail(params));

  await deliver({
    kind: "deletion_confirm",
    label: "deletion-confirm",
    to,
    subject: "Confirm your data-deletion request",
    html,
  });
}

export async function sendDataDeletionReceivedEmail(
  to: string,
  params: { requestId: string },
): Promise<void> {
  const html = await render(DataDeletionReceivedEmail(params));

  await deliver({
    kind: "deletion_received",
    label: "deletion-received",
    to,
    subject: "Your data-deletion request is confirmed",
    html,
  });
}

export async function sendDataDeletionAdminEmail(
  to: string,
  params: { requesterEmail: string; requestId: string; confirmedAtIso: string; dueIso: string; queueUrl: string },
): Promise<void> {
  const html = await render(DataDeletionAdminEmail(params));

  await deliver({
    kind: "deletion_admin",
    label: "deletion-admin",
    to,
    subject: "Data-deletion request awaiting fulfillment",
    html,
  });
}

export async function sendPlatformInviteEmail(
  to: string,
  params: { inviteUrl: string; roleLabel: string },
): Promise<void> {
  const html = await render(
    PlatformInviteEmail({ ...params, expiresInDays: INVITE_TOKEN_TTL_DAYS }),
  );

  await deliver({
    kind: "platform_invite",
    label: "platform-invite",
    to,
    subject: "You're invited to the rmdig staff team",
    html,
  });
}

/** The portal's only restriction email: staff upheld a review request. A lift
 *  is announced by AvServ (contract restrictions.md §6), never here. */
export async function sendRestrictionReviewUpheldEmail(
  to: string,
  params: { feature: string; userReason: string; reviewUrl: string },
): Promise<void> {
  const html = await render(RestrictionReviewUpheldEmail(params));

  await deliver({
    kind: "restriction_review_upheld",
    label: "restriction-review",
    to,
    subject: "AvAI - we reviewed your request",
    html,
  });
}

export async function sendSarTermsPendingReviewEmail(
  to: string,
  params: { orgName: string; reviewUrl: string },
): Promise<void> {
  const html = await render(SarTermsPendingReviewEmail(params));
  await deliver({
    kind: "sar_terms_pending_review",
    label: "SAR-terms-pending-review",
    to,
    subject: `Team terms awaiting review: ${params.orgName}`,
    html,
  });
}

export async function sendSarTermsDecisionEmail(
  to: string,
  params: { orgName: string; decision: SarTermsDecision; version?: number; note?: string; termsUrl: string },
): Promise<void> {
  const html = await render(SarTermsDecisionEmail(params));
  await deliver({
    kind: "sar_terms_decision",
    label: "SAR-terms-decision",
    to,
    subject: params.decision === "published" ? "Your team terms are published" : "Your team terms need changes",
    html,
    log: { decision: params.decision },
  });
}

export async function sendSarAlertNotifyEmail(
  to: string,
  params: { teamName: string; kind: SarAlertNotifyKind; fromAreaUser: boolean; alertsUrl: string },
): Promise<void> {
  const html = await render(SarAlertNotifyEmail(params));
  const subject: Record<SarAlertNotifyKind, string> = {
    overdue: `AvAI alert for ${params.teamName}: missed check-in`,
    send_help: `AvAI alert for ${params.teamName}: Send Help`,
    all_clear: `AvAI alert update for ${params.teamName}: resolved`,
    disregard: `AvAI alert update for ${params.teamName}: retracted`,
  };
  await deliver({ kind: "sar_alert_notify", label: "SAR-alert-notify", to, subject: subject[params.kind], html, log: { alertKind: params.kind } });
}

export async function sendPatrolReverifyStaffEmail(to: string, params: PatrolReverifyStaffEmailProps): Promise<void> {
  const html = await render(PatrolReverifyStaffEmail(params));
  await deliver({
    kind: "patrol_reverify_staff",
    label: "patrol-reverify-staff",
    to,
    subject: params.stage === "lapsed" ? `${params.orgName}: verification lapsed` : `Re-verify ${params.orgName} by ${params.reverifyBy}`,
    html,
    log: { stage: params.stage },
  });
}

export async function sendPatrolReverifyTeamEmail(to: string, params: PatrolReverifyTeamEmailProps): Promise<void> {
  const html = await render(PatrolReverifyTeamEmail(params));
  await deliver({
    kind: "patrol_reverify_team",
    label: "patrol-reverify-team",
    to,
    subject: params.stage === "lapsed" ? "Your patrol's AvAI verification lapsed" : "Annual verification for your patrol",
    html,
    log: { stage: params.stage },
  });
}

export async function sendRestrictionReviewRequestedEmail(to: string, reviewUrl: string): Promise<void> {
  const html = await render(RestrictionReviewRequestedEmail({ reviewUrl }));
  await deliver({ kind: "restriction_review_requested", label: "restriction-review-requested", to, subject: "A restriction review is waiting", html });
}
