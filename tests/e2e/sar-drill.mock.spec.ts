import { expect, test } from "@playwright/test";
import postgres from "postgres";

import { signInAs, STAFF_USER } from "./helpers";

// Drill teams (plan 37): an rmdig admin who is also a SAR approver registers
// a drill team on the default circle, adds its first drill login, and
// activates it. That's CLAUDE.md §0's one exception to hand approval. The team
// never appears in the approvals queue, the activation is logged as no
// review, and the sync, against the mock fleet, which reports drill support,
// waits only for published terms. Mock-mode, so it rides the CI gate.
test.skip(
  !(process.env.AVSERV_BASE_URL || "mock://localhost").startsWith("mock://"),
  "the drill team flow runs against the mock-mode CI server (see playwright.config.ts)",
);

async function q<T extends object>(run: (sql: postgres.Sql) => Promise<T[]>): Promise<T[]> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { prepare: false, max: 1 });
  try {
    return await run(sql);
  } finally {
    await sql.end();
  }
}

const team = (name: string) =>
  q<{ id: string; status: string; is_drill: boolean; proof_doc_url: string | null }>(
    (sql) => sql`SELECT id, status, is_drill, proof_doc_url FROM sar_orgs WHERE name = ${name} LIMIT 1`,
  ).then((r) => r[0] ?? null);

test.describe("drill teams (mock)", () => {
  test("register, add a drill login, activate: never through the approvals queue", async ({ page }) => {
    const stamp = Date.now();
    const name = `E2E Drill ${stamp}`;
    const login = `e2e+drill${stamp}@rmdig.ai`;

    await signInAs(page, STAFF_USER);

    // Register: the area starts as the State Capitol circle, already in place.
    await page.goto("/admin/sar-drill/new");
    await page.getByLabel("Team name").fill(name);
    await page.getByLabel("Contact name").fill("Drill Ops");
    await page.getByLabel("Contact email").fill("ops@rmdig.ai");
    await page.getByRole("button", { name: "Register drill team" }).click();
    await page.waitForURL("**/admin/sar-drill");
    await expect.poll(() => team(name)).toMatchObject({ status: "pending", is_drill: true, proof_doc_url: null });

    // Never in the approvals queue, so never approvable there.
    await page.goto("/admin/sar-approvals");
    await expect(page.getByText(name)).toHaveCount(0);

    // Its first drill login, as the team's admin.
    await page.goto("/admin/sar-drill");
    const card = page.locator("li").filter({ hasText: name });
    await card.getByLabel("Drill address").fill(login);
    await card.getByRole("button", { name: "Add drill login" }).click();
    // The e2e server has no real mail provider, so either answer is right here.
    await expect(card.getByText(new RegExp(`Added ${login.replace(/[+.]/g, "\\$&")}`))).toBeVisible();
    const [user] = await q<{ is_drill: boolean }>((sql) => sql`SELECT is_drill FROM users WHERE email = ${login}`);
    expect(user?.is_drill).toBe(true);

    // Activate: the operator's own logged decision.
    await page.reload();
    await card.getByRole("button", { name: "Activate drill team" }).click();
    await expect.poll(() => team(name).then((t) => t?.status)).toBe("approved");
    const t = await team(name);
    const log = await q<{ action: string; note: string | null }>(
      (sql) => sql`SELECT action::text, note FROM sar_org_status_log WHERE org_id = ${t!.id} ORDER BY created_at`,
    );
    expect(log.map((l) => l.action)).toEqual(["drill_registered", "drill_activated"]);
    expect(log[1]!.note).toBe("drill org activated by the operator; not an independent review");

    // Synced against the mock fleet (which supports drill), it waits only for terms.
    await page.reload();
    await expect(card.getByText(/Waiting for published team terms/).first()).toBeVisible();
  });
});
