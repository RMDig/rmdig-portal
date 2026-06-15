import { render } from "@react-email/components";
import { describe, expect, it } from "vitest";

import OrgInviteEmail from "@/lib/email/templates/OrgInviteEmail";
import ResetPasswordEmail from "@/lib/email/templates/ResetPasswordEmail";
import SarOrgDecisionEmail from "@/lib/email/templates/SarOrgDecisionEmail";
import SarOrgPendingReviewEmail from "@/lib/email/templates/SarOrgPendingReviewEmail";
import SarOrgSubmittedEmail from "@/lib/email/templates/SarOrgSubmittedEmail";
import VerifyEmail from "@/lib/email/templates/VerifyEmail";

// Render-smoke coverage for every transactional template: each renders to HTML
// without throwing and carries its key content (links, names, the right copy).
// Cheap regression guard against a broken prop or a React-Email API change — the
// real cross-client visual check (Gmail/Apple Mail/Outlook) is manual via the
// `pnpm email:dev` preview.

describe("email templates render to HTML", () => {
  it("VerifyEmail carries the verify link", async () => {
    const url = "https://app.rmdig.ai/api/verify?token=abc&email=a%40b.test";
    const html = await render(VerifyEmail({ verifyUrl: url, expiresInHours: 24 }));
    // `&` is HTML-escaped to `&amp;` in the rendered email (correct — mail clients
    // decode it in the href), so assert the pre-`&` portion rather than the raw URL.
    expect(html).toContain("https://app.rmdig.ai/api/verify?token=abc");
    expect(html).toMatch(/verify/i);
    // React Email splits interpolated values from surrounding text with <!-- -->
    // markers, so assert the number and unit separately rather than "24 hours".
    expect(html).toMatch(/expires in/i);
    expect(html).toMatch(/hours/i);
  });

  it("ResetPasswordEmail carries the reset link", async () => {
    const url = "https://app.rmdig.ai/reset-password?token=xyz";
    const html = await render(ResetPasswordEmail({ resetUrl: url, expiresInMinutes: 60 }));
    expect(html).toContain(url);
    expect(html).toMatch(/reset/i);
  });

  it("SarOrgSubmittedEmail names the org", async () => {
    const html = await render(SarOrgSubmittedEmail({ orgName: "San Juan County SAR" }));
    expect(html).toContain("San Juan County SAR");
    expect(html).toMatch(/received/i);
  });

  it("SarOrgPendingReviewEmail names the org, submitter, and review link", async () => {
    const html = await render(
      SarOrgPendingReviewEmail({
        orgName: "San Juan County SAR",
        submitterEmail: "admin@sar.test",
        reviewUrl: "https://app.rmdig.ai/admin/sar-approvals",
      }),
    );
    expect(html).toContain("San Juan County SAR");
    expect(html).toContain("admin@sar.test");
    expect(html).toContain("https://app.rmdig.ai/admin/sar-approvals");
  });

  it("SarOrgDecisionEmail (approved) does NOT leak a note", async () => {
    const html = await render(
      SarOrgDecisionEmail({ orgName: "San Juan SAR", decision: "approved", note: "internal only" }),
    );
    expect(html).toContain("San Juan SAR");
    expect(html).toMatch(/approved/i);
    expect(html).not.toContain("internal only");
  });

  it("SarOrgDecisionEmail (rejected) shows the operator note", async () => {
    const html = await render(
      SarOrgDecisionEmail({
        orgName: "San Juan SAR",
        decision: "rejected",
        note: "Could not verify your registration.",
      }),
    );
    expect(html).toContain("Could not verify your registration.");
  });

  it("SarOrgDecisionEmail (changes_requested) shows the operator note", async () => {
    const html = await render(
      SarOrgDecisionEmail({
        orgName: "San Juan SAR",
        decision: "changes_requested",
        note: "Please attach your county letter.",
      }),
    );
    expect(html).toContain("Please attach your county letter.");
  });

  it("OrgInviteEmail carries the invite link and role", async () => {
    const url = "https://app.rmdig.ai/invite/deadbeef";
    const html = await render(
      OrgInviteEmail({ orgName: "San Juan SAR", inviteUrl: url, role: "responder", expiresInDays: 14 }),
    );
    expect(html).toContain(url);
    expect(html).toContain("San Juan SAR");
    expect(html).toMatch(/responder/i);
    expect(html).toMatch(/expires in/i);
    expect(html).toMatch(/days/i);
  });
});
