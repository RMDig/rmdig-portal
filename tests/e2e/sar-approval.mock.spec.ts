import { expect, test } from "@playwright/test";
import postgres from "postgres";

import { E2E_USER, enterServiceArea, STAFF_USER, signInAs, signOut } from "./helpers";

// SAR approval gate (P1.4; plan 33 §6.9 G2). A member submits an org through
// the real create flow (reused as setup), then a staff persona opens it in the
// queue. Approve sits behind the activation checklist; staff send the test
// alert (item 3) from the row, and the team sees it on its Alerts page. The
// mock node sends nothing (no message reaches the intake) and this team has no
// on-call email, so the test can't pass here and Approve stays disabled: the
// passing path is covered by the unit and integration tests. Mock-mode
// (AvServ-independent) so it rides the always-on CI gate.
test.skip(
  !(process.env.AVSERV_BASE_URL || "mock://localhost").startsWith("mock://"),
  "SAR approval gate runs against the mock-mode CI server (see playwright.config.ts)",
);

async function orgByName(name: string): Promise<{ id: string; status: string } | null> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("orgByName: DATABASE_URL is not set");
  const sql = postgres(url, { prepare: false, max: 1 });
  try {
    const rows = await sql<{ id: string; status: string }[]>`
      SELECT id, status FROM sar_orgs WHERE name = ${name} LIMIT 1
    `;
    return rows[0] ?? null;
  } finally {
    await sql.end();
  }
}
const orgStatusByName = async (name: string) => (await orgByName(name))?.status ?? null;

test.describe("SAR org approval (mock)", () => {
  test("staff send the test alert from the queue, the team sees it, and Approve waits for it to pass", async ({ page }) => {
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

    // Assert: no test yet, so item 3 isn't done and Approve stays disabled.
    await expect(row.getByText("No test sent yet: use Send test alert on this row")).toBeVisible();
    await expect(row.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();

    // Act: send the test; the mock node answers, and the row shows its report.
    await row.getByRole("button", { name: "Send test alert" }).click();
    await expect(row.getByText("Sent from 1 node. Ask the team to confirm each message on its Alerts page.")).toBeVisible();
    await expect(row.getByText(/Portal: delivered to the portal/)).toBeVisible();
    await expect(row.getByText(/Email: not configured on this node \(no on-call email\)/)).toBeVisible();
    await expect(row.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
    expect(await orgStatusByName(orgName)).toBe("pending");

    // The team (its submitting admin) sees the test on its Alerts page: the
    // message hasn't arrived (the mock sends nothing), and there's no email.
    const org = await orgByName(orgName);
    await signOut(page);
    await signInAs(page, E2E_USER);
    await page.goto(`/sar/${org!.id}/alerts`);
    const card = page.getByRole("region", { name: "Test messages" });
    await expect(card).toBeVisible();
    await expect(card.getByText("Portal message: not here yet. Reload in a minute.")).toBeVisible();
    await expect(card.getByText("Email: not configured on this node. Tell rmdig staff.")).toBeVisible();
  });
});
