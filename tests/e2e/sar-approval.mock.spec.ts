import { expect, test } from "@playwright/test";
import postgres from "postgres";

import { E2E_USER, enterServiceArea, STAFF_USER, signInAs, signOut } from "./helpers";

// SAR approval gate (P1.4; plan 33 §6.9 G2). A member submits an org through
// the real create flow (reused as setup), then a staff persona opens it in the
// queue. Approve sits behind the activation checklist, and a real team can't
// be approved until AvServ's test alert (item 3) passes on every node (owner,
// 2026-11-11), so the queue shows the checklist and keeps Approve disabled.
// F2b adds the test alert and the approving half of this spec. Mock-mode
// (AvServ-independent) so it rides the always-on CI gate.
test.skip(
  !(process.env.AVSERV_BASE_URL || "mock://localhost").startsWith("mock://"),
  "SAR approval gate runs against the mock-mode CI server (see playwright.config.ts)",
);

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
  test("the queue shows the activation checklist and won't approve a real team until the test alert passes", async ({ page }) => {
    const orgName = `E2E Approve ${Date.now()}`;

    // Arrange: a member submits an application (reuse the create flow as setup).
    await signInAs(page, E2E_USER);
    await page.goto("/sar/new");
    await page.getByLabel("Organization name").fill(orgName);
    await page.getByLabel("Contact name").fill("Jane Doe");
    await page.getByLabel("Contact email").fill("jane@sar.test");
    await enterServiceArea(page);
    await page.locator('input[name="proofDoc"]').setInputFiles({
      name: "proof.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 e2e approve"),
    });
    await page.locator('input[name="tosAccepted"]').check();
    await page.getByRole("button", { name: /submit application/i }).click();
    await page.waitForURL("**/sar/pending");
    await expect.poll(() => orgStatusByName(orgName)).toBe("pending");

    // Act: switch to the staff persona and open it in the queue, answering
    // what a reviewer answers.
    await signOut(page);
    await signInAs(page, STAFF_USER);
    await page.goto("/admin/sar-approvals");
    const row = page.locator("li").filter({ hasText: orgName });
    await expect(row).toBeVisible();
    await expect(row.getByText("Activation checklist (beta, single review)")).toBeVisible();
    await row.getByLabel("Number you called (the team's publicly listed one)").fill("+1 970 555 0100");
    await row.getByLabel("Who you spoke to").fill("Jane Doe");
    await row.getByLabel("The published terms carry counsel's floor clauses").check();

    // Assert: item 3 is pending, Approve stays disabled, and the team is still pending.
    await expect(row.getByText("Waiting for AvServ's test alert (R13), from every node")).toBeVisible();
    await expect(row.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
    expect(await orgStatusByName(orgName)).toBe("pending");
  });
});
