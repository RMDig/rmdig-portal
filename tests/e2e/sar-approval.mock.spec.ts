import { expect, test } from "@playwright/test";
import postgres from "postgres";

import { E2E_USER, STAFF_USER, signInAs, signOut } from "./helpers";

// SAR approval gate (P1.4). A member submits an org through the real create flow
// (reused as setup), then a staff (rmdig_admin) persona reviews it from the
// queue and approves it — exercising reviewSarOrgAction's transaction + the
// staff-gated /admin/sar-approvals page end-to-end. Mock-mode (AvServ-independent)
// so it rides the always-on CI gate.
test.skip(
  !(process.env.AVSERV_BASE_URL || "mock://localhost").startsWith("mock://"),
  "SAR approval gate runs against the mock-mode CI server (see playwright.config.ts)",
);

const VALID_REGION = JSON.stringify({
  type: "Polygon",
  coordinates: [
    [
      [-108, 37],
      [-107, 37],
      [-107, 38],
      [-108, 38],
      [-108, 37],
    ],
  ],
});

async function orgStatusByName(name: string): Promise<string | null> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("orgStatusByName: DATABASE_URL is not set");
  const sql = postgres(url, { prepare: false, max: 1 });
  try {
    const rows = await sql<{ status: string }[]>`
      SELECT status FROM sar_orgs WHERE name = ${name} LIMIT 1
    `;
    return rows[0]?.status ?? null;
  } finally {
    await sql.end();
  }
}

test.describe("SAR org approval (mock)", () => {
  test("a staff reviewer approves a pending application from the queue", async ({ page }) => {
    const orgName = `E2E Approve ${Date.now()}`;

    // Arrange: a member submits an application (reuse the create flow as setup).
    await signInAs(page, E2E_USER);
    await page.goto("/sar/new");
    await page.getByLabel("Organization name").fill(orgName);
    await page.getByLabel("Contact name").fill("Jane Doe");
    await page.getByLabel("Contact email").fill("jane@sar.test");
    await page.getByTestId("e2e-region-input").fill(VALID_REGION);
    await page.locator('input[name="proofDoc"]').setInputFiles({
      name: "proof.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 e2e approve"),
    });
    await page.locator('input[name="tosAccepted"]').check();
    await page.getByRole("button", { name: /submit application/i }).click();
    await page.waitForURL("**/sar/pending");
    await expect.poll(() => orgStatusByName(orgName)).toBe("pending");

    // Act: switch to the staff persona and approve it from the queue.
    await signOut(page);
    await signInAs(page, STAFF_USER);
    await page.goto("/admin/sar-approvals");
    const row = page.locator("li").filter({ hasText: orgName });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Approve", exact: true }).click();

    // Assert: the decision persisted (the row's status flipped to approved).
    await expect
      .poll(() => orgStatusByName(orgName), {
        message: "reviewSarOrgAction should have set status=approved",
      })
      .toBe("approved");
  });
});
