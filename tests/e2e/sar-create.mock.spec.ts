import { expect, test } from "@playwright/test";
import postgres from "postgres";

import { signIn } from "./helpers";

// SAR org creation gate (P1.4). Drives the real /sar/new form end-to-end —
// validation, proof-doc upload, the create transaction (org + PostGIS region +
// admin membership + audit row), and the pending page — against the same
// disposable Neon branch the device-link gate uses. AvServ-independent, but
// guarded to mock mode so it rides the always-on CI gate and stays out of the
// operator's live AvServ suite.
test.skip(
  !(process.env.AVSERV_BASE_URL || "mock://localhost").startsWith("mock://"),
  "SAR create gate runs against the mock-mode CI server (see playwright.config.ts)",
);

// A closed unit square (lon/lat, WGS84) — the form's region textarea seam
// (NEXT_PUBLIC_E2E) accepts this instead of a canvas draw.
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

/** Read a SAR org's status straight from the DB to prove the create transaction
 *  persisted — not just that the UI navigated. Own short-lived connection (the
 *  app's lib/db pulls in strict env we don't want in-process here). */
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

test.describe("SAR org creation (mock)", () => {
  test("submits an application, persists it pending, and lands on the pending page", async ({
    page,
  }) => {
    await signIn(page);

    // Unique per run so repeated runs against a persistent dev branch don't
    // collide on the name assertion.
    const orgName = `E2E SAR ${Date.now()}`;

    await page.goto("/sar/new");
    await page.getByLabel("Organization name").fill(orgName);
    await page.getByLabel("Contact name").fill("Jane Doe");
    await page.getByLabel("Contact email").fill("jane@sar.test");
    // operatingStatus defaults to county_sar — no detail field needed.
    await page.getByTestId("e2e-region-input").fill(VALID_REGION);
    await page.locator('input[name="proofDoc"]').setInputFiles({
      name: "proof.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 e2e proof"),
    });
    await page.locator('input[name="tosAccepted"]').check();

    await page.getByRole("button", { name: /submit application/i }).click();

    await page.waitForURL("**/sar/pending");
    await expect(page.getByText("Application received")).toBeVisible();
    await expect(page.getByText(orgName)).toBeVisible();

    // The create transaction actually wrote a pending row (this is the boundary
    // the gate exists to protect — org + region + membership + audit in one tx).
    await expect
      .poll(() => orgStatusByName(orgName), {
        message: "createSarOrgAction should have inserted a pending sar_orgs row",
      })
      .toBe("pending");
  });
});
