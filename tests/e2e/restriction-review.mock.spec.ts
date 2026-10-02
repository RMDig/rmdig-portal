import { expect, test } from "@playwright/test";

import { clearReviewRequests, RESTRICTED_USER, signInAs, signOut, STAFF_USER } from "./helpers";

// Restriction review (docs/plans/32; AvServ contract restrictions.md) against
// the hermetic mock AvServ, which seeds one active Incident Detection
// restriction for the "+restricted" persona: the user sees it and asks for a
// review; staff lift it with a note; the user sees it restored.
test.skip(
  !(process.env.AVSERV_BASE_URL || "mock://localhost").startsWith("mock://"),
  "restriction review E2E runs only against AVSERV_BASE_URL=mock://*",
);

test.describe("restriction review (mock AvServ)", () => {
  test("a restricted user asks for review and staff lift it", async ({ page }) => {
    await clearReviewRequests(RESTRICTED_USER.email);

    await signInAs(page, RESTRICTED_USER);
    await page.goto("/account/review");
    await expect(page.getByRole("heading", { name: "Account review" })).toBeVisible();

    // The mock keeps restriction state for the server's lifetime, so a
    // Playwright retry against the same server finds it already lifted —
    // the end state this test drives to; assert it and stop.
    if (await page.getByText("Nothing is restricted").isVisible()) {
      return;
    }

    await expect(page.getByText("Automatic Incident Detection is paused")).toBeVisible();
    await expect(page.getByText(/after a review of recent automatic alerts/)).toBeVisible();

    await page
      .getByLabel("Ask for a review")
      .fill("These were false alarms: my phone was in a pack on a rough road.");
    await page.getByRole("button", { name: "Send review request" }).click();
    // The page re-renders with the open request in place of the form.
    await expect(page.getByText(/Your review request from .* is with our team/)).toBeVisible();

    await signOut(page);
    await signInAs(page, STAFF_USER);
    await page.goto("/admin/restriction-reviews");
    await page.getByRole("link", { name: new RegExp(RESTRICTED_USER.email.replace("+", "\\+")) }).first().click();
    await expect(page.getByText(/my phone was in a pack/)).toBeVisible();
    // Staff see the staff-only operator note in the AvAI history.
    await expect(page.getByText(/Operator note:/)).toBeVisible();

    await page.getByLabel(/Note \(audit log/).fill("Reviewed: false alarms on a rough road.");
    await page.getByRole("button", { name: "Lift" }).click();
    await expect(page.getByText("Decision recorded.")).toBeVisible();
    await expect(page.getByText(/status lifted/)).toBeVisible();

    await signOut(page);
    await signInAs(page, RESTRICTED_USER);
    await page.goto("/account/review");
    await expect(page.getByText("Nothing is restricted")).toBeVisible();
  });
});
