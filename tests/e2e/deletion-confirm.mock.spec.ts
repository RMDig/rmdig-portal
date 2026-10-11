import { createHash, randomBytes } from "node:crypto";

import { expect, test } from "@playwright/test";
import postgres from "postgres";

// Confirming a CPA deletion request takes a deliberate action (plan 35 §1):
// opening the emailed link changes nothing, because mail scanners open links on
// delivery; the requester types the address the request was made for and
// presses Confirm deletion. Sending is not hermetic here (Resend), so the spec
// writes what the intake action writes and starts from the link.

const EMAIL = "e2e-deletion-confirm@rmdig.test";

function db() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("deletion-confirm e2e: DATABASE_URL is not set");
  return postgres(url, { prepare: false, max: 1 });
}

async function pendingRequest(): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const sql = db();
  try {
    await sql`DELETE FROM deletion_requests WHERE email = ${EMAIL}`;
    await sql`
      INSERT INTO deletion_requests (email, token_hash, token_expires_at)
      VALUES (${EMAIL}, ${createHash("sha256").update(token).digest("hex")}, now() + interval '1 day')
    `;
  } finally {
    await sql.end();
  }
  return token;
}

async function status(): Promise<string | undefined> {
  const sql = db();
  try {
    const rows = await sql<{ status: string }[]>`SELECT status FROM deletion_requests WHERE email = ${EMAIL}`;
    return rows[0]?.status;
  } finally {
    await sql.end();
  }
}

test.describe("deletion request confirmation", () => {
  test("opening the link confirms nothing; the right address and the button do", async ({ page }) => {
    const token = await pendingRequest();
    const link = `/account/delete/confirm?token=${token}`;

    await page.goto(link);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Confirm your deletion request" })).toBeVisible();
    expect(await status()).toBe("pending_confirmation");

    await page.getByLabel("Email address").fill("someone-else@rmdig.test");
    await page.getByRole("button", { name: "Confirm deletion" }).click();
    await expect(page.getByText("That isn't the email address this request was made for.")).toBeVisible();
    expect(await status()).toBe("pending_confirmation");

    await page.getByLabel("Email address").fill(EMAIL.toUpperCase());
    await page.getByRole("button", { name: "Confirm deletion" }).click();
    await expect(page.getByRole("heading", { name: "Deletion request confirmed" })).toBeVisible();
    expect(await status()).toBe("confirmed");

    // Revisiting the link shows the confirmation again and changes nothing.
    await page.goto(link);
    await expect(page.getByRole("heading", { name: "Deletion request confirmed" })).toBeVisible();
  });
});
