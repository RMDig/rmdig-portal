import { expect, test } from "@playwright/test";

import { signIn } from "./helpers";

// Plan 05 P-B4 on the mock AvServ: /settings/contacts lists the account's
// emergency contacts with the masked phone and who still has to reply YES. A
// fresh sign-in counts as the recent login the page needs.
test.skip(
  !(process.env.AVSERV_BASE_URL || "mock://localhost").startsWith("mock://"),
  "runs only against AVSERV_BASE_URL=mock://*",
);

test("the contacts page shows who has accepted and who is still waiting", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings");
  await page.getByRole("link", { name: "View contacts" }).click();
  await expect(page.getByRole("heading", { name: "Emergency contacts", level: 1 })).toBeVisible();
  await expect(page.getByText("1 of your 2 contacts has accepted.")).toBeVisible();

  const jane = page.getByRole("listitem").filter({ hasText: "Jane Alder" });
  await expect(jane.getByText("Phone ending 0101 · email on file")).toBeVisible();
  await expect(jane.getByText("Accepted", { exact: true })).toBeVisible();

  const sam = page.getByRole("listitem").filter({ hasText: "Sam Rivera" });
  await expect(sam.getByText("Phone ending 0102", { exact: true })).toBeVisible();
  await expect(sam.getByText("Waiting for YES")).toBeVisible();
});
