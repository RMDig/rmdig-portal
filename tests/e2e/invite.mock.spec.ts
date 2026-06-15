import { expect, test } from "@playwright/test";

import { E2E_USER, INVITEE_USER, orgRoleFor, seedApprovedOrg, signInAs, signOut } from "./helpers";

// Org invitation gate (P1.4). An admin of an approved org invites a member, then
// the invitee accepts via the tokenized link and lands as a member — exercising
// createInvitationAction + the public /invite/[token] accept flow end-to-end.
// Mock-mode (AvServ-independent) so it rides the always-on CI gate.
test.skip(
  !(process.env.AVSERV_BASE_URL || "mock://localhost").startsWith("mock://"),
  "invite gate runs against the mock-mode CI server (see playwright.config.ts)",
);

test.describe("org invitations (mock)", () => {
  test("an admin invites a member who accepts via the link", async ({ page }) => {
    const orgName = `E2E Invite ${Date.now()}`;
    const orgId = await seedApprovedOrg(E2E_USER.email, orgName);

    // Admin (the member persona owns this org) sends an invite.
    await signInAs(page, E2E_USER);
    await page.goto(`/sar/${orgId}/members`);
    await page.getByLabel("Email").fill(INVITEE_USER.email);
    // Role defaults to responder.
    await page.getByRole("button", { name: /send invite/i }).click();

    // The members page shows the shareable link on success — grab it.
    await expect(page.locator("code")).toBeVisible();
    const inviteUrl = (await page.locator("code").innerText()).trim();
    expect(inviteUrl).toContain("/invite/");

    // The invitee signs in and accepts via the link.
    await signOut(page);
    await signInAs(page, INVITEE_USER);
    await page.goto(new URL(inviteUrl).pathname);
    await page.getByRole("button", { name: /accept invitation/i }).click();
    await page.waitForURL("**/dashboard");

    // The invitation became a membership row (responder, the default role).
    await expect
      .poll(() => orgRoleFor(INVITEE_USER.email, orgId), {
        message: "acceptInvitationAction should have created a responder membership",
      })
      .toBe("responder");
  });
});
