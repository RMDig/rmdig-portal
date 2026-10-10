import { createHash, randomBytes } from "node:crypto";

import { expect, test } from "@playwright/test";
import postgres from "postgres";

// Email-first sign-up (beta plan D1a) in a real browser: the sign-up page asks
// only for an email, and the emailed link opens the page where the password is
// chosen. Sending is not hermetic here (Resend), so the spec writes what
// signUpAction writes (an unverified row with no password, plus a hashed link)
// and starts from the link. The submit path is unit-tested.

const EMAIL = "e2e-email-first@rmdig.test";
const PASSWORD = "E2e-email-first-6t1v!K";

function db() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("email-first-signup e2e: DATABASE_URL is not set");
  return postgres(url, { prepare: false, max: 1 });
}

/** A fresh pending sign-up for EMAIL; returns the plaintext link token. */
async function pendingSignUp(): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const sql = db();
  try {
    await sql`DELETE FROM users WHERE email = ${EMAIL}`;
    await sql`DELETE FROM verification_tokens WHERE identifier = ${EMAIL}`;
    await sql`INSERT INTO users (email, signup_intent) VALUES (${EMAIL}, 'explorer')`;
    await sql`
      INSERT INTO verification_tokens (identifier, token, expires)
      VALUES (${EMAIL}, ${createHash("sha256").update(token).digest("hex")}, now() + interval '1 hour')
    `;
  } finally {
    await sql.end();
  }
  return token;
}

test.describe("email-first sign-up", () => {
  test("the sign-up page asks for no password", async ({ page }) => {
    await page.goto("/sign-up");
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with email" })).toBeVisible();
  });

  test("the link survives being opened, sets the password once, and the account signs in", async ({ page }) => {
    const token = await pendingSignUp();
    // An old-style link forwards to the same page; opening it twice (a mail
    // scanner, then the person) uses nothing up.
    await page.goto(`/api/verify?token=${token}&email=${encodeURIComponent(EMAIL)}`);
    await expect(page).toHaveURL(/\/sign-up\/finish\?/);
    await page.reload();
    await expect(page.getByText("Choose your password", { exact: true })).toBeVisible();

    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirm password").fill(PASSWORD);
    await page.getByRole("button", { name: "Set password" }).click();
    await page.waitForURL("**/sign-in?verified=true");

    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/dashboard");

    await page.context().clearCookies();
    await page.goto(`/sign-up/finish?token=${token}&email=${encodeURIComponent(EMAIL)}`);
    await expect(page.getByText("This link can't be used", { exact: true })).toBeVisible();
  });
});
