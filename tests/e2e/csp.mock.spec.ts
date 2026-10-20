import { expect, test } from "@playwright/test";

import { signIn, watchCspViolations } from "./helpers";

// Plan 36 H1: the Report-Only policy (middleware.ts, lib/csp.ts) against the
// production build. A clean run means enforcing it breaks none of these pages.
// The map has its own check in map-render.mock.spec.ts, which runs after a
// spec has given the persona something to show.
test.skip(
  !(process.env.AVSERV_BASE_URL || "mock://localhost").startsWith("mock://"),
  "CSP check runs against the mock-mode CI server (see playwright.config.ts)",
);

test.describe("content security policy (mock)", () => {
  test("public pages carry a nonce policy and would block nothing", async ({ page }) => {
    const violations = await watchCspViolations(page);
    for (const path of ["/", "/privacy", "/sign-in", "/status", "/collection_signup"]) {
      const res = await page.goto(path);
      expect(res?.headers()["content-security-policy-report-only"], path).toMatch(/'nonce-[^']+' 'strict-dynamic'/);
      await page.waitForLoadState("networkidle");
      expect(await violations(), path).toEqual([]);
    }
  });

  test("signed-in pages would block nothing", async ({ page }) => {
    const violations = await watchCspViolations(page);
    await signIn(page);
    expect(await violations(), "after sign-in").toEqual([]);
    for (const path of ["/settings", "/settings/devices", "/map"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      expect(await violations(), path).toEqual([]);
    }
  });
});
