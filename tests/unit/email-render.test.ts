import { render } from "@react-email/components";
import { describe, expect, it } from "vitest";

import OrgInviteEmail from "@/lib/email/templates/OrgInviteEmail";
import ResetPasswordEmail from "@/lib/email/templates/ResetPasswordEmail";
import RestrictionReviewUpheldEmail from "@/lib/email/templates/RestrictionReviewUpheldEmail";
import AdCreativeDecisionEmail from "@/lib/email/templates/AdCreativeDecisionEmail";
import DataDeletionAdminEmail from "@/lib/email/templates/DataDeletionAdminEmail";
import DeletionClockEmail from "@/lib/email/templates/DeletionClockEmail";
import SarOrgDecisionEmail from "@/lib/email/templates/SarOrgDecisionEmail";
import SarTermsDecisionEmail from "@/lib/email/templates/SarTermsDecisionEmail";
import SarOrgPendingReviewEmail from "@/lib/email/templates/SarOrgPendingReviewEmail";
import SarOrgSubmittedEmail from "@/lib/email/templates/SarOrgSubmittedEmail";
import VerifyEmail from "@/lib/email/templates/VerifyEmail";

// Render-smoke coverage for every transactional template: each renders to HTML
// without throwing and carries its key content (links, names, the right copy).
// Cheap regression guard against a broken prop or a React-Email API change — the
// real cross-client visual check (Gmail/Apple Mail/Outlook) is manual via the
// `pnpm email:dev` preview.

describe("email templates render to HTML", () => {
  it("DeletionClockEmail lists each request's reference and time left, never the requester", async () => {
    const html = await render(
      DeletionClockEmail({
        escalated: true,
        items: [
          { requestId: "req-1", confirmedAtIso: "2026-08-20T00:00:00.000Z", dueIso: "2026-10-04T00:00:00.000Z", daysLeft: -3 },
          { requestId: "req-2", confirmedAtIso: "2026-09-01T00:00:00.000Z", dueIso: "2026-10-16T00:00:00.000Z", daysLeft: 9 },
        ],
        queueUrl: "https://rmdig.ai/admin/deletion-requests",
      }),
    );
    expect(html).toContain("req-1");
    expect(html).toContain("past the deadline");
    expect(html).toContain("9 days left");
    expect(html).toContain("https://rmdig.ai/admin/deletion-requests");
    expect(html).toMatch(/near their deadline/);
    expect(html).not.toMatch(/@/);
  });

  it("RestrictionReviewUpheldEmail carries the user reason, the review link, and what still works", async () => {
    const url = "https://rmdig.ai/account/review?restriction=33333333-3333-4333-8333-333333333333";
    const html = await render(
      RestrictionReviewUpheldEmail({
        feature: "Automatic Incident Detection",
        userReason: "Paused after a review of recent automatic alerts.",
        reviewUrl: url,
      }),
    );
    expect(html).toContain("Paused after a review of recent automatic alerts.");
    expect(html).toContain(url);
    expect(html).toMatch(/Send Help work exactly as before/);
  });

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

  it("SarOrgSubmittedEmail names the org and links to the application", async () => {
    const html = await render(SarOrgSubmittedEmail({ orgName: "San Juan County SAR", statusUrl: "https://rmdig.ai/sar/pending" }));
    expect(html).toContain("https://rmdig.ai/sar/pending");
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

  it("SarOrgDecisionEmail links approved teams to their team and change requests to the application", async () => {
    const team = "https://rmdig.ai/sar/o1/members";
    const approved = await render(SarOrgDecisionEmail({ orgName: "San Juan SAR", decision: "approved", actionUrl: team }));
    expect(approved).toContain(team);
    expect(approved).toContain("Open your team");
    const edit = "https://rmdig.ai/sar/o1/edit";
    const changes = await render(SarOrgDecisionEmail({ orgName: "San Juan SAR", decision: "changes_requested", note: "x", actionUrl: edit }));
    expect(changes).toContain(edit);
    expect(changes).toContain("Edit your application");
  });

  it("AdCreativeDecisionEmail says 'published' only once the ad reached the app, and links to the creative", async () => {
    const url = "https://rmdig.ai/advertiser/a1/creatives/c1";
    const base = { advertiserName: "Demo Outfitters", headline: "Wax up", creativeUrl: url };
    const live = await render(AdCreativeDecisionEmail({ ...base, decision: "approved", published: true }));
    expect(live).toContain("published to the app");
    expect(live).toContain(url);
    const notYet = await render(AdCreativeDecisionEmail({ ...base, decision: "approved", published: false }));
    expect(notYet).not.toContain("published to the app");
    expect(notYet.replace(/&#x27;|&apos;/g, "'")).toContain("It isn't in the app yet");
    const edit = await render(AdCreativeDecisionEmail({ ...base, creativeUrl: `${url}/edit`, decision: "changes_requested", note: "Shorter headline." }));
    expect(edit).toContain(`${url}/edit`);
    expect(edit).toContain("Edit your ad");
  });

  it("AdCreativeDecisionEmail tells the advertiser a suspended ad is out of the app, with staff's note", async () => {
    const html = await render(
      AdCreativeDecisionEmail({ advertiserName: "Demo Outfitters", headline: "Wax up", decision: "suspended", note: "Link is broken.", creativeUrl: "https://rmdig.ai/x" }),
    );
    expect(html).toContain("taken out of the app");
    expect(html).toContain("Link is broken.");
  });

  it("SarTermsDecisionEmail links to the team's terms", async () => {
    const url = "https://rmdig.ai/sar/o1/terms";
    const html = await render(SarTermsDecisionEmail({ orgName: "San Juan SAR", decision: "published", version: 2, termsUrl: url }));
    expect(html).toContain(url);
  });

  it("DataDeletionAdminEmail gives the deadline and links to the queue, not SQL", async () => {
    const html = await render(
      DataDeletionAdminEmail({
        requesterEmail: "a@b.co",
        requestId: "r1",
        confirmedAtIso: "2026-10-01T00:00:00.000Z",
        dueIso: "2026-11-15T00:00:00.000Z",
        queueUrl: "https://rmdig.ai/admin/deletion-requests",
      }),
    );
    expect(html).toContain("2026-11-15");
    expect(html).toContain("https://rmdig.ai/admin/deletion-requests");
    expect(html).not.toContain("completed_at");
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
