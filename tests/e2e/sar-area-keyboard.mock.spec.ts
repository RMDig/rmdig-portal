import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";

import { signIn, SQUARE_AREA } from "./helpers";

// The service area without a mouse (plan 33 §6.3 step 4, step 9.6; WCAG
// 2.1.1). Tabs into the corner-points table, types each point, adds one with
// the keyboard, applies with Enter, and submits; then checks the saved region
// in the database is the typed one. The editor is the same on /sar/new,
// resubmit and the area page, so /sar/new stands for all three. axe scans the
// editor before and after, the error state included.
test.skip(
  !(process.env.AVSERV_BASE_URL || "mock://localhost").startsWith("mock://"),
  "Runs against the mock-mode CI server (see playwright.config.ts)",
);

async function regionByName(name: string): Promise<number[][][] | null> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("regionByName: DATABASE_URL is not set");
  const sql = postgres(url, { prepare: false, max: 1 });
  try {
    const rows = await sql<{ geojson: string | null }[]>`
      SELECT ST_AsGeoJSON(region_geom::geometry)::text AS geojson FROM sar_orgs WHERE name = ${name} LIMIT 1
    `;
    const g = rows[0]?.geojson;
    return g ? (JSON.parse(g) as { coordinates: number[][][] }).coordinates : null;
  } finally {
    await sql.end();
  }
}

async function axeEditor(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).include('[data-testid="area-editor"]').analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

/** Press Tab until `label` has focus, proving it's reachable from the keyboard. */
async function tabTo(page: Page, label: string): Promise<void> {
  const target = page.getByLabel(label, { exact: true });
  for (let i = 0; i < 80; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Tab never reached ${label}`);
}

test.describe("SAR service area by keyboard (mock)", () => {
  test("types the corner points, applies them with Enter, and saves that area", async ({ page }) => {
    await signIn(page);
    const orgName = `E2E Keyboard ${Date.now()}`;
    await page.goto("/sar/new");
    await axeEditor(page);

    await page.getByLabel("Organization name").fill(orgName);
    await page.getByLabel("Contact name").fill("Jane Doe");
    await page.getByLabel("Contact email").fill("jane@sar.test");

    // From the field before the area, Tab reaches the table: the map doesn't trap focus.
    await page.getByLabel("Contact email").focus();
    await tabTo(page, "Point 1 latitude");

    // A bad point is named and marked, and Enter doesn't submit the form.
    await page.keyboard.type("north");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Point 1: enter a latitude between -90 and 90", { exact: false })).toBeVisible();
    await expect(page.getByLabel("Point 1 latitude", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await expect(page).toHaveURL(/\/sar\/new$/);
    await axeEditor(page);
    await page.keyboard.press("ControlOrMeta+a");

    // Three rows to start: latitude, Tab, longitude, Tab past Remove, next row.
    for (const [i, [lat, lon]] of SQUARE_AREA.slice(0, 3).entries()) {
      await expect(page.getByLabel(`Point ${i + 1} latitude`, { exact: true })).toBeFocused();
      await page.keyboard.type(lat);
      await page.keyboard.press("Tab");
      await page.keyboard.type(lon);
      await page.keyboard.press("Tab"); // Remove
      await page.keyboard.press("Tab"); // next row, or "Add a point"
    }
    // "Add a point" puts the cursor in the new row.
    await expect(page.getByRole("button", { name: "Add a point" })).toBeFocused();
    await page.keyboard.press("Enter");
    const [lat4, lon4] = SQUARE_AREA[3]!;
    await expect(page.getByLabel("Point 4 latitude", { exact: true })).toBeFocused();
    await page.keyboard.type(lat4);
    await page.keyboard.press("Tab");
    await page.keyboard.type(lon4);
    await page.keyboard.press("Enter");

    await expect(page.getByText("Using these 4 points.")).toBeVisible();
    await expect(page.getByText(/This area is about [\d,]+ km²\./)).toBeVisible();
    await expect(page.getByText("The map can't show these points", { exact: false })).toHaveCount(0);
    await axeEditor(page);

    await page.locator('input[name="proofDoc"]').setInputFiles({
      name: "proof.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 e2e keyboard"),
    });
    await page.locator('input[name="tosAccepted"]').check();
    await page.getByRole("button", { name: /submit application/i }).press("Enter");
    await page.waitForURL("**/sar/pending");

    await expect
      .poll(() => regionByName(orgName), { message: "the typed area should be the saved region" })
      .toEqual([[[-108, 37], [-107, 37], [-107, 38], [-108, 38], [-108, 37]]]);
  });
});
