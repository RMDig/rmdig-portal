import { randomBytes, randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

import { MOCK_LIVE_ACCOUNT_ID, MOCK_MISMATCH_ACCOUNT_ID } from "../../lib/avserv/erasure-mock";
import { MFA_ADMIN_USER, signInWithTotp } from "./helpers";

// The operator's "Erase in AvServ" on /admin/deletion-requests against the
// mock AvServ (account_erasure.md rev 1): an admin with two-factor checks
// every node, re-types the account id, erases, and sees every node's record.
// Live safety state blocks the erase; a refusal as someone else's account stops.
test.skip(
  !(process.env.AVSERV_BASE_URL || "mock://localhost").startsWith("mock://"),
  "runs only against AVSERV_BASE_URL=mock://*",
);

const EMAIL = `e2e-erasure-${Date.now()}@rmdig.test`;

async function db<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { prepare: false, max: 1 });
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}

test.beforeAll(async () => {
  await db(async (sql) => {
    // The portal's 5-a-day erasure limit is per portal, so earlier runs on a
    // reused database would otherwise use it up.
    await sql`DELETE FROM rate_limits WHERE key LIKE 'avserv-erasure:%'`;
    await sql`INSERT INTO deletion_requests (email, token_hash, token_expires_at, status, confirmed_at)
      VALUES (${EMAIL}, ${randomBytes(32).toString("hex")}, now() + interval '1 day', 'confirmed', now())`;
  });
});

test.afterAll(async () => {
  await db((sql) => sql`DELETE FROM deletion_requests WHERE email = ${EMAIL}`);
});

async function check(page: Page, accountId: string) {
  const card = page.locator("div", { has: page.getByText(EMAIL, { exact: true }) }).filter({ has: page.getByText("Erase in AvServ") }).last();
  await card.getByLabel("Account to erase (AvAI account id)").fill(accountId);
  await card.getByRole("button", { name: "Check every node" }).click();
  return card;
}

test("an admin with two-factor erases an account, and refusals stop it", async ({ page }) => {
  await signInWithTotp(page, MFA_ADMIN_USER);
  await page.goto("/admin/deletion-requests");
  await expect(page.getByText(EMAIL, { exact: true })).toBeVisible();

  // Live safety state: blocked, and no erase is offered.
  let card = await check(page, MOCK_LIVE_ACCOUNT_ID);
  await expect(card.getByText(/blocked by a check-out/)).toBeVisible();
  await expect(card.getByRole("button", { name: "Erase this account" })).toHaveCount(0);

  // Not the requester's account: AvServ refuses, and the page says stop.
  card = await check(page, MOCK_MISMATCH_ACCOUNT_ID);
  await expect(card.getByText("erasable")).toBeVisible();
  await card.getByLabel(/Type the account id again/).fill(MOCK_MISMATCH_ACCOUNT_ID);
  await card.getByRole("button", { name: "Erase this account" }).click();
  await expect(card.getByText(/Stopped: this account's email isn't the requester's/)).toBeVisible();

  // The real thing: erase, then every node's record and the note.
  await page.reload();
  const accountId = randomUUID();
  card = await check(page, accountId);
  await expect(card.getByText("erasable")).toBeVisible();
  const erase = card.getByRole("button", { name: "Erase this account" });
  await expect(erase).toBeDisabled();
  await card.getByLabel(/Type the account id again/).fill(accountId);
  await erase.click();
  await expect(card.getByText("Erased.", { exact: true })).toBeVisible();
  await expect(card.getByText("Erased on every node.")).toBeVisible();
  await expect(card.getByText(new RegExp(`AvServ: erased AvAI account ${accountId}`))).toBeVisible();
});
