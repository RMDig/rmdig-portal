import { render } from "@react-email/components";
import { Resend } from "resend";

import { env } from "../env";
import { logger } from "../logger";
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
