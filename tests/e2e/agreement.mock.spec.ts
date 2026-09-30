import { expect, test } from "@playwright/test";

import { signIn } from "./helpers";

// AvAI web onboarding (docs/plans/31; AvServ contract account_agreement.md rev
// 2 §4) against the hermetic mock AvServ: names → the agreement text → scroll
// to the end → tick → I agree → the account shows as set up. The page renders
// the labelled E2E fixture (E2E_AGREEMENT_FIXTURE, set by playwright.config)
// because no real version is pinned yet.
test.skip(
  !(process.env.AVSERV_BASE_URL || "mock://localhost").startsWith("mock://"),
  "agreement E2E runs only against AVSERV_BASE_URL=mock://*",
);

test.describe("AvAI agreement (mock AvServ)", () => {
  test("a signed-in user sets their names and accepts the agreement", async ({ page }) => {
    await signIn(page);

    await page.goto("/settings");
    await expect(page.getByText("AvAI account", { exact: true })).toBeVisible();

    await page.goto("/settings/agreement");
    await expect(page.getByRole("heading", { name: "AvAI user agreement" })).toBeVisible();
    await expect(page.getByText(/Test fixture for automated tests/)).toBeVisible();

    // The mock keeps state for the server's lifetime, so a Playwright retry
    // against the same server finds the acceptance already recorded — which is
    // itself the idempotent outcome; assert it and stop.
    if (await page.getByText(/You accepted this agreement/).isVisible()) {
      await expect(page.getByRole("button", { name: "I agree" })).toHaveCount(0);
      return;
    }

    // The seeded persona's portal name ("E2E Device Link") has digits, so it
    // must NOT be prefilled as the alert name (plan 31 D1).
    await expect(page.getByLabel("Name on your alerts")).toHaveValue("");

    await page.getByLabel("Legal name").fill("Jane Q. Public");
    await page.getByLabel("Name on your alerts").fill("Jane");
    await page.getByText("Another placeholder paragraph.").scrollIntoViewIfNeeded();
    await page.getByLabel("TEST FIXTURE: I am 18 or older.").check();
    await page.getByLabel("TEST FIXTURE: I agree to this test text.").check();
    await expect(page.getByRole("button", { name: "I agree" })).toBeEnabled();
    await page.getByRole("button", { name: "I agree" }).click();

    await expect(page.getByText("Agreement accepted. Your AvAI account is set up.")).toBeVisible();

    await page.goto("/settings");
    await expect(page.getByText(/^Set up on /)).toBeVisible();
    await expect(page.getByText(/e2e-fixture accepted/)).toBeVisible();
  });
});
