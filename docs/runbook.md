# rmdig-portal operator runbook

Common operator tasks for `app.rmdig.ai`. This is the **how-to-operate** companion
to [infrastructure.md](infrastructure.md) (what's provisioned) and
`CLAUDE_BOOTSTRAP.md` (how the app is built).

> **Production-safety rule.** Several tasks below run SQL or scripts against the
> **production** Neon database. Before any of them: (1) confirm the connection
> string is the production branch, not dev or a disposable branch; (2) prefer the
> guarded scripts (`pnpm db:*`) over ad-hoc SQL; (3) for manual SQL, read the row
> first (`SELECT`) before you `UPDATE`/`DELETE`. There is no undo on a pooled prod
> connection.

## Connecting to production

The app reads `DATABASE_URL` from Vercel env (injected by the Neon integration).
To run a script/migration against production from your machine, pull the prod
env into a throwaway file and use it for that one command:

```bash
vercel env pull .env.production.local --environment production
# then run with that env, e.g.:
DATABASE_URL="$(grep '^DATABASE_URL=' .env.production.local | cut -d= -f2-)" pnpm db:migrate
```

`.env.production.local` is gitignored by Next.js by default — delete it when
you're done. **Never** point `pnpm test:e2e` or the E2E `global-setup` at this URL;
those seed/mutate the `users` table (they refuse to run without `E2E_ALLOW_DB=1`
precisely so this can't happen by accident).

## Grant a platform role

Platform roles (`rmdig_admin`, `rmdig_reviewer`) gate the `/admin` area. The user
must have **signed up first** (the script promotes an existing account).

```bash
# rmdig_admin — full operator (idempotent, safe to re-run):
DATABASE_URL=<prod-url> pnpm db:seed-admin you@example.com
```

`db:seed-admin` only grants `rmdig_admin`. To grant the narrower
`rmdig_reviewer` (SAR approvals only), insert the row directly:

```sql
INSERT INTO user_platform_roles (user_id, role)
SELECT id, 'rmdig_reviewer' FROM users WHERE email = 'reviewer@example.com'
ON CONFLICT DO NOTHING;
```

To revoke a role: `DELETE FROM user_platform_roles WHERE user_id = (SELECT id FROM users WHERE email = '…') AND role = '…';`

## Review a SAR org application

SAR org applications are reviewed in the UI — no SQL needed.

1. Sign in as a user with `rmdig_admin` or `rmdig_reviewer`.
2. Go to **Admin → SAR approvals** (`/admin/sar-approvals`).
3. Each pending org shows its submitter, type, a service-area map, and a link to
   the proof-of-status document. Verify the org is real (registration / 501(c)(3))
   and the service area is sane.
4. Choose one:
   - **Approve** → status `approved`; the org admin can now invite members. Emails the submitter.
   - **Reject** (reason required) → status `rejected`. Emails the submitter the reason.
   - **Request changes** (note required) → stays `pending`; emails the submitter what to fix.

Every action appends to `sar_org_status_log` (append-only audit) and is attributed
to you. Manual approval is non-negotiable — safety-of-life alerts must never route
to an unverified org.

## Reset a user's MFA

When a user has lost their authenticator **and** their recovery codes. (If they
still have recovery codes, have them sign in with one and re-enroll themselves —
no operator action needed.)

**Verify identity out-of-band first** (this clears their second factor):

```sql
-- Read first to confirm you have the right account:
SELECT id, email, mfa_enabled_at FROM users WHERE email = 'user@example.com';

-- Clear the TOTP secret + enrollment, then drop their recovery codes:
UPDATE users SET totp_secret_encrypted = NULL, mfa_enabled_at = NULL
WHERE email = 'user@example.com';
DELETE FROM mfa_recovery_codes
WHERE user_id = (SELECT id FROM users WHERE email = 'user@example.com');
```

This mirrors the self-service "disable MFA" path exactly. The user re-enrolls at
`/settings/mfa/enroll` on next sign-in (and is nagged/required to per
`MFA_ENFORCEMENT`). *Future hardening: wrap this in a guarded `db:reset-mfa <email>`
script like `db:seed-admin`.*

## Suspend / reactivate a SAR org

There is **no UI action for this yet** (the approvals queue handles
approve/reject/request-changes only). Do it manually, and **mirror the audit
pattern** the UI uses so history stays complete:

```sql
-- Suspend an approved org:
UPDATE sar_orgs SET status = 'suspended' WHERE id = '<org-uuid>';
INSERT INTO sar_org_status_log (org_id, action, from_status, to_status, actor_user_id)
VALUES ('<org-uuid>', 'suspended', 'approved', 'suspended', (SELECT id FROM users WHERE email = '<your-email>'));

-- Reactivate (back to pending for re-review, per the state machine):
UPDATE sar_orgs SET status = 'pending' WHERE id = '<org-uuid>';
INSERT INTO sar_org_status_log (org_id, action, from_status, to_status, actor_user_id)
VALUES ('<org-uuid>', 'reactivated', 'suspended', 'pending', (SELECT id FROM users WHERE email = '<your-email>'));
```

*Future hardening: add suspend/reactivate to the admin UI so this isn't hand-SQL.*

## Run a production migration

Vercel auto-deploys `main` on merge, so a PR that adds a migration must have it
applied to production **before** the merge — otherwise the new code deploys
against an old schema.

```bash
DATABASE_URL=<prod-url> pnpm db:migrate
```

`db:migrate` is idempotent (it skips already-applied migrations), so running it
again is safe. Confirm with `SELECT * FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 5;` if unsure what's applied.

## Flip MFA enforcement at public launch

`MFA_ENFORCEMENT` (`optional` | `admin_only` | `all`) is a Vercel env var, not
code. Today it's `admin_only` (staff must have MFA; everyone else is nagged). At
public launch, set it to `all` in **Vercel → Production env**, then redeploy
(re-deploy the latest production build so the new value is picked up). Staff
already require MFA regardless.

## Routine maintenance

See [infrastructure.md](infrastructure.md) §Maintenance for the schedule:
- **Credential rotation** — `RESEND_API_KEY`, `SENTRY_AUTH_TOKEN`,
  `GOOGLE_CLIENT_SECRET`, `NEXTAUTH_SECRET` annually or on suspected compromise.
- **DMARC tightening** — `p=quarantine` → `p=reject` after clean aggregate reports.
- **Neon compute** — free tier auto-suspends after 5 min idle; bump to paid once
  real users are on.
- **Sentry quota** — watch the 5k errors/month free tier during soft launch.
