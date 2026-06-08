import { expect, test } from "@playwright/test";

import { E2E_USER, expectMintedCodeVisible, queryAvservAccountId, signIn } from "./helpers";

// Opt-in live suite: the true cross-service check against a real AvServ. Runs
// only when the operator exports AVSERV_LIVE_E2E=1 alongside a real
// AVSERV_BASE_URL and AVSERV_SERVICE_JWT_SIGNING_KEY (so the server can sign the
// service JWT). Otherwise skipped, keeping CI green without a live dependency.
test.skip(
  process.env.AVSERV_LIVE_E2E !== "1",
  "live device-link E2E is opt-in: set AVSERV_LIVE_E2E=1 with a real AVSERV_BASE_URL + AVSERV_SERVICE_JWT_SIGNING_KEY",
);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

test.describe("device-link flow (live AvServ)", () => {
  test("login maps a real account uuid, devices view loads, code mints", async ({ page }) => {
    await signIn(page);

    // P-B1 against real AvServ: the map persists a genuine account UUID.
    await expect
      .poll(() => queryAvservAccountId(E2E_USER.email), {
        message: "signIn event should have mapped a real AvServ account",
      })
      .not.toBeNull();
    expect(await queryAvservAccountId(E2E_USER.email)).toMatch(UUID_RE);

    // P-B3: the view loads. A fresh account legitimately has zero devices, so we
    // assert the page renders (not a specific device) — empty is a valid state.
    // CardTitle is a <div>; assert the page's <h1> and the card title by text.
    await page.goto("/settings/devices");
    await expect(page.getByRole("heading", { name: "Devices" })).toBeVisible();
    await expect(page.getByText("Linked devices")).toBeVisible();

    // P-B2 against real AvServ: minting returns a usable code (shape is AvServ's
    // to define, so assert the success state rather than a fixed pattern).
    await page.getByRole("button", { name: /generate link code/i }).click();
    await expectMintedCodeVisible(page);
  });
});
