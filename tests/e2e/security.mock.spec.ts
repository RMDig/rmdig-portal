import { expect, test } from "@playwright/test";

import { signIn } from "./helpers";

// Plan 36 §5.2–§5.3 on the mock AvServ: the security page lists the account's
// activity from AvServ's feed, and notices can be turned on and off. A fresh
// sign-in counts as a recent login.
test.skip(
  !(process.env.AVSERV_BASE_URL || "mock://localhost").startsWith("mock://"),
  "runs only against AVSERV_BASE_URL=mock://*",
);

test("the security page shows activity, and notices turn on and off", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings/security");
  await expect(page.getByRole("heading", { name: "Security" })).toBeVisible();
  await expect(page.getByText("A phone was registered").first()).toBeVisible();
  await expect(page.getByText("A contact was added")).toBeVisible();

  await page.getByRole("button", { name: "Turn notices on" }).click();
  await expect(page.getByText("Security notices are on.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Security notices turned on")).toBeVisible();
  await page.getByRole("button", { name: "Turn notices off" }).click();
  await expect(page.getByText("Security notices are off.")).toBeVisible();
});
