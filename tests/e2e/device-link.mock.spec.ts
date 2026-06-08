import { expect, test } from "@playwright/test";

import {
  clearAvservAccountId,
  E2E_USER,
  expectMintedCodeVisible,
  queryAvservAccountId,
  signIn,
} from "./helpers";

// Always-on CI gate (bootstrap §6). Runs against the hermetic mock AvServ, so it
// needs no service key or live AvServ — only the dev/test DB. Skips if the
// server was booted against a real AvServ (that's the live suite's job).
// `||` (not `??`): an empty AVSERV_BASE_URL from .env.local must fall back to
// the mock default, matching the web server's own resolution in playwright.config.
test.skip(
  !(process.env.AVSERV_BASE_URL || "mock://localhost").startsWith("mock://"),
  "mock device-link E2E runs only against AVSERV_BASE_URL=mock://* (see device-link.live.spec.ts)",
);

// Mock link-code alphabet (no ambiguous 0/O/1/I), grouped XXXX-XXXX.
const MOCK_CODE_RE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

test.describe("device-link flow (mock AvServ)", () => {
  test("login maps the account, devices render, and a code mints", async ({ page }) => {
    // Pre-state: reset the mapping so "the map runs on THIS login" is provable
    // even on a retry (global-setup seeds once per invocation, not per test).
    await clearAvservAccountId(E2E_USER.email);
    expect(await queryAvservAccountId(E2E_USER.email)).toBeNull();

    await signIn(page);

    // P-B1: the signIn event maps the user to an AvServ account. Assert it
    // actually persisted — this is the boundary the gate exists to protect.
    await expect
      .poll(() => queryAvservAccountId(E2E_USER.email), {
        message: "signIn event should have populated avserv_account_id",
      })
      .not.toBeNull();

    // P-B3: the linked-devices view renders the mock's deterministic devices.
    // CardTitle is a <div>, not a heading — assert the page's <h1> for "loaded"
    // and match the card title / device rows by text.
    await page.goto("/settings/devices");
    await expect(page.getByRole("heading", { name: "Devices" })).toBeVisible();
    await expect(page.getByText("Linked devices")).toBeVisible();
    await expect(page.getByText("iOS", { exact: false })).toBeVisible();
    await expect(page.getByText("macOS", { exact: false })).toBeVisible();

    // P-B2: minting a link-code shows a single-use XXXX-XXXX code.
    await page.getByRole("button", { name: /generate link code/i }).click();
    await expectMintedCodeVisible(page);
    await expect(page.getByText(MOCK_CODE_RE)).toBeVisible();
  });
});
