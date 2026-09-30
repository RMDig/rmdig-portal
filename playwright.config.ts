import { defineConfig, devices } from "@playwright/test";

// E2E harness for the device-link flow — the bootstrap §6 gate for P1.3. It
// drives a real browser through credentials login → the AvServ account map
// (P-B1, fired in the signIn event) → the linked-devices view (P-B3) → mint a
// link-code (P-B2), crossing the most service boundaries in the portal.
//
// Two suites share this config and self-select on env (see each spec's
// test.skip):
//   • device-link.mock.spec.ts — always-on CI gate, AVSERV_BASE_URL=mock://*.
//   • device-link.live.spec.ts — opt-in, runs only when AVSERV_LIVE_E2E=1 with a
//     real AVSERV_BASE_URL + AVSERV_SERVICE_JWT_SIGNING_KEY.
//
// global-setup seeds a verified, non-staff credentials user into the database
// pointed at by DATABASE_URL — which MUST be a disposable Neon dev/test branch,
// never production (the setup refuses a prod-looking URL).

const PORT = Number(process.env.E2E_PORT ?? 3000);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  // The flow is inherently sequential (shared seeded user, login state); keep it
  // single-worker so the two specs can't race on that one row.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm build && pnpm start --port ${PORT}`,
    url: baseURL,
    // Locally, reuse a running `pnpm dev`; in CI always boot a clean build+start.
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      // CI=true makes lib/env skip strict validation, so the server boots for the
      // login/settings flows without the full secret set (Apple/Resend/etc.).
      CI: "true",
      // Keep enforcement out of the way: a non-staff user under 'optional' isn't
      // nagged or gated, so login lands straight on /dashboard.
      MFA_ENFORCEMENT: "optional",
      // Default to the hermetic mock; the live suite overrides this via the
      // operator's exported env before invoking Playwright. `||` (not `??`) so an
      // empty AVSERV_BASE_URL inherited from .env.local also falls back to mock.
      AVSERV_BASE_URL: process.env.AVSERV_BASE_URL || "mock://localhost",
      // SAR create gate (P1.4): keep proof-doc upload hermetic (no Blob token,
      // no junk objects) and let the form accept region GeoJSON via a textarea
      // since the headless browser can't reliably draw on the map canvas. Both
      // flags are E2E-only seams; production never sets them.
      E2E_FAKE_BLOB: "1",
      NEXT_PUBLIC_E2E: "1",
      // AvAI onboarding (docs/plans/31 §4): while no agreement version is
      // pinned, present the labelled test fixture so the accept flow is
      // exercisable. Honored only with AVSERV_BASE_URL=mock://* (lib/agreement).
      E2E_AGREEMENT_FIXTURE: "1",
    },
  },
});
