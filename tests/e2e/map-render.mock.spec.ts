import { expect, test } from "@playwright/test";

import { signIn } from "./helpers";

// MapLibre boots in the production build (beta blocker B6). maplibre-gl v6 runs
// its tile worker from a separate file that only resolves under the bundler when
// components/map/load-maplibre.ts sets the worker URL; without it the map stays
// blank and the console says "Worker failed to load". Unit tests can't see this
// (no bundler, no browser), so it is checked here against `next build` output.
test.skip(
  !(process.env.AVSERV_BASE_URL || "mock://localhost").startsWith("mock://"),
  "map render check runs against the mock-mode CI server (see playwright.config.ts)",
);

test.describe("map rendering (mock)", () => {
  test("the /map page starts MapLibre and its worker without errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    const workerRequests: string[] = [];
    page.on("request", (r) => {
      if (/maplibre-gl-worker/.test(r.url())) workerRequests.push(r.url());
    });

    await signIn(page);
    await page.goto("/map");
    await expect(page.locator("canvas.maplibregl-canvas").first()).toBeVisible();
    await expect.poll(() => workerRequests.length, { message: "the MapLibre worker should be fetched" }).toBeGreaterThan(0);

    expect(errors.filter((e) => /worker/i.test(e))).toEqual([]);
  });
});
