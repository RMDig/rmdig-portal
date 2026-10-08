import { expect, type Page } from "@playwright/test";
import postgres from "postgres";

// Shared E2E fixtures: a small roster of role personas and the helpers used
// across the suites. Personas are STABLE IDENTITIES — seeded once by
// global-setup with a fixed role/auth state, and read by tests ("sign in as the
// staff user"). Per-test mutable workflow data (orgs, invitations) is created
// fresh inside each test (uniquely named) so tests never collide on it. Seed new
// personas only as a spec needs them — don't accumulate unused fixtures.

export interface E2eUser {
  email: string;
  password: string;
  displayName: string;
}

/** Verified, no platform role, no MFA — the default user. Device-link + SAR
 *  create sign in as this one; it lands straight on /dashboard. */
export const E2E_USER: E2eUser = {
  email: "e2e-device-link@rmdig.test",
  // High-entropy local-only credential; these users exist solely in the dev/test
  // branch global-setup seeds. Never real accounts.
  password: "E2e-device-link-9f3a!Q",
  displayName: "E2E Device Link",
} as const;

/** rmdig_admin + rmdig_sar_approver platform staff — for the SAR approvals queue. */
export const STAFF_USER: E2eUser = {
  email: "e2e-staff@rmdig.test",
  password: "E2e-staff-7k2p!Z",
  displayName: "E2E Staff",
} as const;

/** A second plain user, for the invitation-accept flow (PR-D). */
export const INVITEE_USER: E2eUser = {
  email: "e2e-invitee@rmdig.test",
  password: "E2e-invitee-4m9x!Q",
  displayName: "E2E Invitee",
} as const;

/** A user whose AvAI account is restricted. The mock AvServ seeds one active
 *  Incident Detection restriction for any login tagged "+restricted"
 *  (lib/avserv/restrictions-mock.ts), so this persona drives the review flow. */
export const RESTRICTED_USER: E2eUser = {
  email: "e2e-review+restricted@rmdig.test",
  password: "E2e-review-3q8w!R",
  displayName: "E2E Review",
} as const;

/** The roster global-setup seeds, with the platform role (if any) to grant. */
export const E2E_PERSONAS: { user: E2eUser; platformRoles: Array<"rmdig_admin" | "rmdig_sar_approver"> }[] = [
  { user: E2E_USER, platformRoles: [] },
  { user: STAFF_USER, platformRoles: ["rmdig_admin", "rmdig_sar_approver"] },
  { user: INVITEE_USER, platformRoles: [] },
  { user: RESTRICTED_USER, platformRoles: [] },
];

/** Sign in via the real credentials form (single-factor; seeded users have no
 *  MFA and the E2E server runs MFA_ENFORCEMENT=optional). */
export async function signInAs(page: Page, user: E2eUser): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
}

/** Sign in as the default user — exercises the signIn event that maps the AvServ
 *  account. Back-compat wrapper used by the device-link + SAR-create specs. */
export async function signIn(page: Page): Promise<void> {
  await signInAs(page, E2E_USER);
}

/** Drop the session so a test can switch personas (clears the auth cookie). */
export async function signOut(page: Page): Promise<void> {
  await page.context().clearCookies();
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
  await expect(page.getByText(/Enter this code in the AvAI app before/i)).toBeVisible();
}

/** Seed an APPROVED SAR org owned (admin) by `ownerEmail`, returning its id —
 *  setup for the invitation flow, which requires an approved org. Inserts the
 *  org + the owner's admin membership directly (region_geom is nullable and not
 *  needed here), so the test doesn't have to drive create → approve first. */
export async function seedApprovedOrg(ownerEmail: string, orgName: string): Promise<string> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("seedApprovedOrg: DATABASE_URL is not set");
  const sql = postgres(url, { prepare: false, max: 1 });
  try {
    const [owner] = await sql<{ id: string }[]>`
      SELECT id FROM users WHERE email = ${ownerEmail} LIMIT 1
    `;
    if (!owner) throw new Error(`seedApprovedOrg: no seeded user ${ownerEmail}`);
    const [org] = await sql<{ id: string }[]>`
      INSERT INTO sar_orgs
        (name, contact_name, contact_email, operating_status, proof_doc_url,
         status, created_by_user_id, approved_at, approved_by_user_id)
      VALUES
        (${orgName}, 'E2E Owner', 'owner@sar.test', 'county_sar',
         'https://blob.local/e2e.pdf', 'approved', ${owner.id}, now(), ${owner.id})
      RETURNING id
    `;
    await sql`
      INSERT INTO org_memberships (org_id, user_id, role)
      VALUES (${org!.id}, ${owner.id}, 'admin')
      ON CONFLICT DO NOTHING
    `;
    return org!.id;
  } finally {
    await sql.end();
  }
}

/** The org role a user holds (by email) in an org, or null — lets a test assert
 *  an invitation was actually accepted into a membership row. */
export async function orgRoleFor(email: string, orgId: string): Promise<string | null> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("orgRoleFor: DATABASE_URL is not set");
  const sql = postgres(url, { prepare: false, max: 1 });
  try {
    const rows = await sql<{ role: string }[]>`
      SELECT m.role FROM org_memberships m
      JOIN users u ON u.id = m.user_id
      WHERE u.email = ${email} AND m.org_id = ${orgId}
      LIMIT 1
    `;
    return rows[0]?.role ?? null;
  } finally {
    await sql.end();
  }
}

/** Delete a user's restriction review requests (and, by cascade, their log),
 *  so the review flow starts clean on every run and retry. */
export async function clearReviewRequests(email: string): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("clearReviewRequests: DATABASE_URL is not set");
  const sql = postgres(url, { prepare: false, max: 1 });
  try {
    await sql`
      DELETE FROM restriction_review_requests
      WHERE user_id = (SELECT id FROM users WHERE email = ${email})
    `;
  } finally {
    await sql.end();
  }
}
