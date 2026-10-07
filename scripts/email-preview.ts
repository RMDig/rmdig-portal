import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { render } from "@react-email/components";
import { type ReactElement } from "react";

import OrgInviteEmail from "../lib/email/templates/OrgInviteEmail";
import ResetPasswordEmail from "../lib/email/templates/ResetPasswordEmail";
import SarOrgDecisionEmail from "../lib/email/templates/SarOrgDecisionEmail";
import SarOrgPendingReviewEmail from "../lib/email/templates/SarOrgPendingReviewEmail";
import SarOrgSubmittedEmail from "../lib/email/templates/SarOrgSubmittedEmail";
import VerifyEmail from "../lib/email/templates/VerifyEmail";

// Render every transactional email to a static HTML file under .email-preview/
// (gitignored), with realistic sample content, so you can open them in a browser
// or forward them to yourself to check rendering in Gmail / Apple Mail / Outlook.
// The cross-client pass is manual by nature; this produces the artifacts for it.
//
//   pnpm email:preview

const OUT = ".email-preview";

const samples: { file: string; element: ReactElement }[] = [
  {
    file: "verify.html",
    element: VerifyEmail({
      verifyUrl: "https://app.rmdig.ai/api/verify?token=PREVIEW&email=you%40example.com",
      expiresInHours: 24,
    }),
  },
  {
    file: "reset-password.html",
    element: ResetPasswordEmail({
      resetUrl: "https://app.rmdig.ai/reset-password?token=PREVIEW",
      expiresInMinutes: 60,
    }),
  },
  {
    file: "sar-submitted.html",
    element: SarOrgSubmittedEmail({ orgName: "San Juan County SAR", statusUrl: "https://rmdig.ai/sar/pending" }),
  },
  {
    file: "sar-pending-review.html",
    element: SarOrgPendingReviewEmail({
      orgName: "San Juan County SAR",
      submitterEmail: "admin@sanjuansar.org",
      reviewUrl: "https://app.rmdig.ai/admin/sar-approvals",
    }),
  },
  {
    file: "sar-approved.html",
    element: SarOrgDecisionEmail({ orgName: "San Juan County SAR", decision: "approved", actionUrl: "https://rmdig.ai/sar/00000000-0000-4000-8000-000000000000/members" }),
  },
  {
    file: "sar-rejected.html",
    element: SarOrgDecisionEmail({
      orgName: "San Juan County SAR",
      decision: "rejected",
      note: "We couldn't verify your county registration. Reply with a current letter and we'll re-review.",
    }),
  },
  {
    file: "sar-changes-requested.html",
    element: SarOrgDecisionEmail({
      orgName: "San Juan County SAR",
      decision: "changes_requested",
      note: "Please redraw your service area — it currently overlaps the neighboring county.",
    }),
  },
  {
    file: "org-invite.html",
    element: OrgInviteEmail({
      orgName: "San Juan County SAR",
      inviteUrl: "https://app.rmdig.ai/invite/PREVIEWTOKEN",
      role: "responder",
      expiresInDays: 14,
    }),
  },
];

async function main() {
  await mkdir(OUT, { recursive: true });
  for (const { file, element } of samples) {
    const html = await render(element);
    await writeFile(path.join(OUT, file), html, "utf8");
    console.log(`✓ ${path.join(OUT, file)}`);
  }
  console.log(
    `\nOpen ${OUT}/*.html in a browser, or forward them to yourself to check Gmail / Apple Mail / Outlook.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
