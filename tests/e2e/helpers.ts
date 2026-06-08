import { expect, type Page } from "@playwright/test";
import postgres from "postgres";

// Shared E2E fixtures: the seeded test user and small helpers used by both the
// mock and live device-link suites.

export const E2E_USER = {
  email: "e2e-device-link@rmdig.test",
  // High-entropy local-only credential; this user exists solely in the dev/test
  // branch global-setup seeds. Never a real account.
  password: "E2e-device-link-9f3a!Q",
  displayName: "E2E Device Link",
} as const;

/** Sign in via the real credentials form (single-factor; the seeded user has no
 *  MFA), exercising the signIn event that performs the AvServ account map. */
export async function signIn(page: Page): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(E2E_USER.email);
  await page.getByLabel("Password", { exact: true }).fill(E2E_USER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
}

/** Read the user's mapped AvServ account id straight from the DB, so a test can
 *  assert the signIn-event map (P-B1) actually persisted — not just infer it
 *  from the UI. Opens its own short-lived connection (the app's lib/db pulls in
 *  strict env we don't want in-process here). */
export async function queryAvservAccountId(email: string): Promise<string | null> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("queryAvservAccountId: DATABASE_URL is not set");
  const sql = postgres(url, { prepare: false, max: 1 });
  try {
    const rows = await sql<{ avserv_account_id: string | null }[]>`
      SELECT avserv_account_id FROM users WHERE email = ${email} LIMIT 1
    `;
    return rows[0]?.avserv_account_id ?? null;
  } finally {
    await sql.end();
  }
}

/** Reset the user's AvServ mapping to NULL so the map-on-login assertion is
 *  honest regardless of test ordering or retries (global-setup seeds only once
 *  per invocation, so a retried test would otherwise see a prior run's mapping). */
export async function clearAvservAccountId(email: string): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("clearAvservAccountId: DATABASE_URL is not set");
  const sql = postgres(url, { prepare: false, max: 1 });
  try {
    await sql`UPDATE users SET avserv_account_id = NULL WHERE email = ${email}`;
  } finally {
    await sql.end();
  }
}

/** The mint-code success state shows the code plus this copy; shape-agnostic so
 *  it works against both the mock's deterministic code and a real AvServ code. */
export async function expectMintedCodeVisible(page: Page): Promise<void> {
  await expect(page.getByText(/Enter this code in AvApp before/i)).toBeVisible();
}
