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

Production is the **`production` branch (the default) of Neon project
`lingering-waterfall-99928244`** (org: Rocky Mountain Digerati). As of
2026-07-22 the Vercel Production `DATABASE_URL` is a **manually-set env var
pinned to that branch's pooled endpoint** — it overrides the Neon integration,
whose injected mapping had production traffic pointed at the `vercel-dev`
branch while the Vercel *Development* env held the production-branch URL
(discovered when migration 0009 "succeeded" but prod couldn't see the table).
If you re-connect or reconfigure the Neon integration, re-pin `DATABASE_URL`
by hand (below) before the next deploy. The dashboard saying "production" is not
proof: on 2026-10-02 it said so while the re-created value reached a database
without the portal schema, and every signed-in page failed until the re-pin.

### Re-pin the production `DATABASE_URL`

```bash
U=$(neonctl connection-string production --project-id lingering-waterfall-99928244 \
  --role-name neondb_owner --database-name neondb --pooled)
case "$U" in *ep-crimson-thunder-aqloj3r3-pooler*) echo "host ok";; *) echo "WRONG HOST, stop";; esac
psql "$U" -tAc "select to_regclass('public.rate_limits')"   # must print rate_limits
vercel env rm DATABASE_URL production -y
printf '%s' "$U" | vercel env add DATABASE_URL production --sensitive --yes; unset U
vercel env ls production | grep -E ' DATABASE_URL '        # must list it before you redeploy
vercel redeploy <current production deployment URL> --target production
curl -s https://rmdig.ai/readyz                               # must be "ready"
```

For **Production**, don't pass a git-branch argument to `vercel env add`. With
`""` it adds nothing and says nothing, and a redeploy then runs with no
database URL at all (2026-10-02, about 20 min of 500s).

`vercel env pull --environment production` does NOT work for secrets anymore —
integration vars are marked sensitive and pull as empty strings. Get the URL
from the Neon CLI instead:

```bash
pnpm dlx neonctl connection-string production \
  --project-id lingering-waterfall-99928244 --pooled
# then run one command against it, e.g.:
DATABASE_URL="<that url>" pnpm db:migrate
```

**Never** point `pnpm test:e2e` or the E2E `global-setup` at this URL;
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
3. Each pending org shows its submitter, its kind (search & rescue team or
   ski-area patrol), its operating status, a service-area map, and "View document"
   (proof of status, opened through the staff-only route; see "SAR proof
   documents"). Verify the org is real (registration / 501(c)(3)) and the service
   area is sane.
4. **Ski-area patrols:** before approving, call the ski area on a number you find
   yourself (its website or a directory listing), never one from the application,
   and confirm the patrol and its contact person (AvApp doc 36 §9.3). Note the
   call in the approval note.
5. Choose one:
   - **Approve** → status `approved`; the org admin can now invite members. Emails the submitter.
   - **Reject** (reason required) → status `rejected`. Emails the submitter the reason.
   - **Request changes** (note required) → stays `pending`; emails the submitter what to fix.
     Their admins see your note on `/sar/pending` and can **edit and resubmit**
     (`/sar/<orgId>/edit`): every field except the verified phone, plus a redrawn
     area and a replacement document if they choose. A resubmission logs
     `resubmitted`, clears your note and emails every `rmdig_admin`. Approved orgs
     can't be edited this way (§0).

Every action appends to `sar_org_status_log` (append-only audit) and is attributed
to you. Manual approval is non-negotiable — safety-of-life alerts must never route
to an unverified org.

## SAR org members

Org admins manage their own team at `/sar/<orgId>/members`: invite (by email,
role chosen), change a member's role, remove a member, leave, and revoke a
pending invitation.

- **Always at least one admin.** Demoting or removing the last admin, including
  yourself, is refused. Make someone else an admin first.
- **Every change is logged** in `org_membership_log` with the actor: `joined`
  (accepted an invitation), `role_changed`, `removed`, `left` and `invite_revoked`.
  The subject's email is snapshotted.
- **MFA:** with `MFA_ENFORCEMENT=admin_only`, SAR org admins must enroll, like
  rmdig staff.
- **The team's only admin is unreachable** (left the team, lost access): staff
  can make another member admin in SQL after verifying the request with the org
  out of band, and should record why:

```sql
UPDATE org_memberships SET role = 'admin' WHERE org_id = '<org>' AND user_id = '<user>';
INSERT INTO org_membership_log (org_id, action, subject_user_id, subject_email, to_role, actor_user_id)
  VALUES ('<org>', 'role_changed', '<user>', '<their email>', 'admin', '<your user id>');
```

## Reset a user's MFA

When a user has lost their authenticator **and** their recovery codes. (If they
still have recovery codes, have them sign in with one and re-enroll themselves —
no operator action needed.)

**Verify identity out-of-band first** — this clears their second factor:

```bash
DATABASE_URL=<prod-url> pnpm db:reset-mfa user@example.com
```

The script clears the TOTP secret + enrollment and drops their recovery codes
(exactly the self-service "disable MFA" path). The user re-enrolls at
`/settings/mfa/enroll` on next sign-in (and is nagged/required to per
`MFA_ENFORCEMENT`).

## Suspend / reactivate a SAR org

Use the approvals queue (`/admin/sar-approvals`) — it lists approved and
suspended orgs alongside pending ones:

- **Suspend** an approved org (optional reason) → status `suspended`; it stops
  appearing as an active org.
- **Reactivate** a suspended org → status `pending`, back into the review queue.

Both append to `sar_org_status_log` and are attributed to you, same as the review
decisions. (Suspend / reactivate don't email the org — communicate out of band
if needed.)

## Run a production migration

Vercel auto-deploys `main` on merge, so a PR that adds a migration must have it
applied to production **before** the merge — otherwise the new code deploys
against an old schema.

```bash
DATABASE_URL=<prod-url> pnpm db:migrate
```

`db:migrate` is idempotent (it skips already-applied migrations), so running it
again is safe. Confirm with `SELECT * FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 5;` if unsure what's applied.

Get the URL in its own step and check it before using it — a `$(...)` around a
command that fails (expired `neonctl auth`, a `pnpm dlx` install prompt) puts
garbage in `DATABASE_URL`:

```bash
export DATABASE_URL="$(neonctl connection-string production --project-id lingering-waterfall-99928244 --pooled)"
case "$DATABASE_URL" in postgresql://*|postgres://*) echo "URL looks right";; *) echo "NOT a database URL, stop";; esac
pnpm db:migrate
unset DATABASE_URL
```

## Migration guard

The CI job **"Migrations applied to production"** (`pnpm migrations:check-prod`,
`lib/db/migration-guard.ts`) fails a main-targeted PR when:

- the branch has a migration production hasn't applied yet → apply it (above),
  then click **Re-run** on the job; or
- a migration is unapplied but **older** than production's latest, which
  `db:migrate` would skip forever (crossed migration branches) → regenerate it
  on top of main.

It warns (doesn't fail) when production has a migration the branch doesn't know:
usually another PR's, applied first — rebase. A PR that doesn't touch
`lib/db/migrations/` passes with a notice if the secret is missing; one that does
fails until the secret exists. An unreachable database fails, never passes.

**One-time setup:**

1. In the Neon SQL editor, on the **production** branch, as the owner role,
   create a role that can only read Drizzle's migration table (pick a long
   random password):
   ```sql
   CREATE ROLE ci_migration_reader WITH LOGIN PASSWORD '<long random password>';
   GRANT USAGE ON SCHEMA drizzle TO ci_migration_reader;
   GRANT SELECT ON drizzle.__drizzle_migrations TO ci_migration_reader;
   ```
   It cannot read user tables or write anything (verified: `permission denied`).
2. Build its connection string from the production one (same host and
   database, `sslmode=require`), swapping in `ci_migration_reader` and its
   password.
3. GitHub → Settings → Secrets and variables → Actions → **New repository
   secret** `PROD_MIGRATIONS_READ_URL` = that string.
4. GitHub → Settings → Branches → the `main` rule → **Require status checks**
   → add **Migrations applied to production**. Without this the job is red but
   the merge button still works.

This is the only CI job that touches production, and only with that read-only
role; E2E never does (`E2E_ALLOW_DB`).

## Data-deletion requests (Colorado Privacy Act)

Confirmed requests arrive by email to every `rmdig_admin` (the requester proved
control of the address via the `/account/delete` confirmation link). The CPA
clock is **45 days from `confirmed_at`**. Precise geolocation is sensitive data
under the CPA — treat every request as covering it.

1. **Find the request** (queue = everything confirmed but not completed):

   ```sql
   SELECT id, email, confirmed_at FROM deletion_requests
   WHERE status = 'confirmed' ORDER BY confirmed_at;
   ```

2. **Portal data.** If a `users` row matches the email, delete it — sessions,
   accounts, MFA rows, memberships, tokens cascade. Caveat: rows the user
   *created* for org-shaped entities (`sar_orgs.created_by_user_id`,
   `advertiser_accounts.created_by_user_id`, invitation `created_by_user_id`)
   have plain FKs and will block the delete. If they own such rows, decide per
   entity (transfer or delete the org) before deleting the user.
3. **AvServ data.** Delete the account's checkout history, heartbeat rows, and
   emergency-contact details on AvServ (operator process; no S2S deletion
   endpoint yet — track as an AvServ work item).
4. **Record completion** so the queue stays truthful:

   ```sql
   UPDATE deletion_requests
   SET status = 'completed', completed_at = now(),
       note = '<what was erased, where>'
   WHERE id = '<request-id>';
   ```

5. **Reply to the requester** from the support mailbox confirming completion.
   The reply must go out within the 45-day window even if the answer is "we
   held no data for this address."

## Flip MFA enforcement at public launch

`MFA_ENFORCEMENT` (`optional` | `admin_only` | `all`) is a Vercel env var, not
code. Today it's `admin_only` (staff must have MFA; everyone else is nagged). At
public launch, set it to `all` in **Vercel → Production env**, then redeploy
(re-deploy the latest production build so the new value is picked up). Staff
already require MFA regardless.

## Database backups

Two independent mechanisms, different failure domains:

1. **Neon point-in-time restore** (managed, always on) — check the history
   retention window on the `production` branch of project
   `lingering-waterfall-99928244` and bump it if the plan allows; restore =
   create a branch from a timestamp in the Neon console.
2. **Nightly encrypted dump to Cloudflare R2** —
   [.github/workflows/db-backup.yml](../.github/workflows/db-backup.yml),
   09:00 UTC. `pg_dump -Fc` → `age`-encrypt → upload to
   `r2://<bucket>/portal-db/`. Retention 30 days (disclosed in `/privacy`);
   the bucket lifecycle rule is the primary expiry, the workflow prune step is
   backup.

**One-time setup** (workflow skips, green, until this is done):

1. Generate an age keypair locally: `age-keygen -o portal-backup.key`. Store
   the **private key** in the password manager (and nowhere else — not GitHub,
   not R2). The public key (`age1…`) is not sensitive.
2. Cloudflare → R2: create bucket `rmdig-portal-backups`; add a lifecycle rule
   deleting objects under `portal-db/` after 30 days; create an R2 API token
   scoped to that bucket (Object Read & Write).
3. GitHub repo → Settings → Secrets and variables → Actions:
   - Secrets: `PROD_DATABASE_URL` (pinned prod Neon URL via
     `neonctl connection-string` — see "Connecting to production"),
     `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
   - Variables: `AGE_PUBLIC_KEY` (the `age1…` string),
     `R2_BACKUP_BUCKET=rmdig-portal-backups`, and finally
     `DB_BACKUPS_ENABLED=1` to arm the schedule.
4. Run the workflow once by hand (Actions → db-backup → Run workflow) and
   confirm an object lands in the bucket.

**Restore drill** (quarterly — an untested backup is a hope, not a backup):

1. Download the newest `portal-db/*.dump.age` from R2.
2. `age -d -i portal-backup.key -o portal.dump portal-<stamp>.dump.age`
3. Create a scratch Neon branch off `production`, then
   `pg_restore -d "<scratch branch URL>" --clean --if-exists --no-owner portal.dump`
4. Spot-check row counts (`users`, `sar_orgs`, `deletion_requests`) against
   prod, then delete the scratch branch.

If a nightly run fails, GitHub emails the repo owner — treat a red `db-backup`
run as an incident, not noise: the second mechanism existing is the point.

**Password-reset note:** rotating `PROD_DATABASE_URL` (Neon password reset)
must be mirrored into this GitHub secret in the same sitting, or backups break
silently at the next 09:00 UTC run. This secret takes the **non-pooled** URL
(host without `-pooler`): `pg_dump` should not go through the pooler.

## Rotating the database password

The `neondb_owner` password lives in several places; a reset breaks every one
not updated in the same sitting.

1. Neon console → Roles → `neondb_owner` → Reset password. Copy the **connection
   string** form (not the `psql '…'` form).
2. Vercel → Settings → Environment Variables → **`DATABASE_URL`** (Production):
   paste the **pooled** URL (host with `-pooler`), bare — no quotes, no `psql`.
3. GitHub secret `PROD_DATABASE_URL` (backups): the **non-pooled** URL.
4. Any `.env.local` that uses it.
5. Check the key name before redeploying — `vercel env ls production` must list
   `DATABASE_URL` exactly. **2026-10-01/02:** it was saved as `DATABSE_URL`, every
   server route returned 500 for ~20 h, and the log said
   `DATABASE_URL: … received undefined`.
6. Redeploy, then verify `/healthz`, one public page, and a real sign-in.

`PROD_MIGRATIONS_READ_URL` uses its own role (`ci_migration_reader`) and is not
affected.

## SAR proof documents

Proof-of-status documents (county SAR registrations, 501(c)(3) letters) live in
a **private** Vercel Blob store. Nothing links to them directly. Staff open one
from the approvals queue ("View document"), which goes through
`/admin/sar-approvals/proof/<orgId>`. That route checks the staff role, streams
the file with `Cache-Control: private, no-store`, and logs `sar.proof.viewed`.
Anyone else gets a 404.

**One-time switch to a private store (before merging the PR that adds this):**
1. Create the store: Vercel → Storage → Create → Blob → access **Private**, or
   `vercel blob create-store rmdig-sar-proofs --access private`.
2. Connect it to `rmdig-portal` for **Production only**, in place of the current
   public store. Disconnect the old one first, so `BLOB_STORE_ID` now names the
   private store. Blob privacy is per store, and proof documents are the only
   thing in Blob.
3. Redeploy, then submit a test SAR application with a PDF, open it from the
   approvals queue, and reject the test org.

**Legacy documents:** anything uploaded before the switch lives in the old public
store, and the route still reads those by their public URL. Leave the old store in
place until no pending, approved or suspended org still points at it:

```sql
SELECT id, name FROM sar_orgs WHERE proof_doc_url LIKE '%.public.blob.vercel-storage.com%';
```

Once that returns nothing you still need, delete the old store.

## Preview deployments

Every PR gets a Vercel preview you can sign in to. Previews hold **no real user
data** and never reach the live AvServ:

- **Database:** a separate Neon project, `rmdig-portal-preview`, not a branch of
  production. (Neon's Vercel integration can only fork preview branches from the
  default branch, which here is production, so every preview would carry copies
  of real users.) It has two branches: `preview-seed` (schema plus the test
  personas) and its child `preview`, which every preview deployment shares.
- **Migrations:** the `vercel-build` script runs `scripts/migrate-preview.ts`
  before `next build`. On a preview it applies the PR's migrations to `preview`;
  in production it does nothing (production is still migrated by hand before
  merge, see "Run a production migration"). It refuses the production endpoint.
- **AvServ:** `mock://localhost`. The `+restricted` persona gets one active
  restriction from the mock.
- **Email:** logged as `email.<kind>.preview_logged` (recipient and subject,
  never the body), not sent. To get a real email on a preview, add your address
  to `PREVIEW_EMAIL_RECIPIENTS`; an email is sent only if every recipient is listed.
- **Startup check:** on `VERCEL_ENV=preview`, the server refuses to boot if
  `DATABASE_URL` is the production endpoint or `AVSERV_BASE_URL` isn't `mock://`.
- **Sign-in:** email and password with a persona. Google sign-in doesn't work on
  previews (each preview URL would need its own registered redirect URI).

### One-time setup

1. **Neon:** create the project `rmdig-portal-preview` (same region as
   production). Rename its default branch to `preview-seed`. Copy its
   **non-pooled** connection string.
2. **Migrate and seed `preview-seed`** from a local checkout of `main`:
   ```bash
   SEED=$(neonctl connection-string preview-seed --project-id <preview project id>)
   DATABASE_URL="$SEED" pnpm db:migrate
   read -rs -p "Preview seed password: " PW; echo   # 16+ chars, from the password manager
   PREVIEW_SEED_DATABASE_URL="$SEED" PREVIEW_SEED_PASSWORD="$PW" \
     pnpm db:seed-preview you@example.com --admin you@work.example; unset PW
   ```
   The prompt keeps the password out of shell history. A literal value in the
   command is used as-is: on 2026-10-02 a placeholder became the real password
   and the accounts had to be deleted and re-seeded.
   This creates five personas on your address with plus tags: `+admin`
   (`rmdig_admin`), `+user`, `+sar` (admin of an approved test SAR org), `+advertiser`
   (admin of a test advertiser) and `+restricted`. All share that password and are
   email-verified. Re-running is safe. Each `--admin <address>` adds one more
   `rmdig_admin` account, so you can sign in to previews as yourself. It's a
   separate preview account, not your production one, and it uses the same
   seed password. To add it later, seed both `preview-seed` and `preview`, or
   seed `preview-seed` and then reset `preview` from it.
3. **Neon:** create the branch `preview` from `preview-seed`. Copy its **pooled**
   and **non-pooled** connection strings.
4. **Vercel → Storage → the Neon database → Allowed Environments:** set it to
   **Production** only. That stops the integration creating production copies for
   previews and removes its Preview-scoped `DATABASE_URL*` / `POSTGRES_*` / `PG*`
   variables. The integration **re-creates the Production variables** when you do
   this, replacing the hand-pinned `DATABASE_URL`: re-pin it ("Re-pin the production
   `DATABASE_URL`" above) before anything deploys. Do the same
   for the **Blob store** (Production only), or previews upload SAR proofs into
   the production store. Then delete the production project's `preview/*` branches
   (`neonctl branches delete <name> --project-id lingering-waterfall-99928244`);
   each one is a copy of production.
5. **Vercel → Settings → Environment Variables**, scoped to **Preview only**, with
   values different from production:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | `preview` branch, pooled |
   | `DATABASE_URL_UNPOOLED` | `preview` branch, non-pooled |
   | `NEXTAUTH_SECRET` | new: `openssl rand -hex 32` |
   | `MFA_ENCRYPTION_KEY` | new: `openssl rand -hex 32` |
   | `AVSERV_BASE_URL` | `mock://localhost` |
   | `MFA_ENFORCEMENT` | `optional` (each reset of `preview` would otherwise force the admin persona to enroll again) |
   | `PREVIEW_EMAIL_RECIPIENTS` | empty, or your own address while testing a template |

   From the CLI, pipe the value in and pass the git branch and sensitivity
   explicitly, or the prompts swallow the piped value and nothing is added:
   `printf '%s' "$VALUE" | vercel env add NAME preview "" --sensitive --yes`.
   The `""` (all preview branches) is for Preview only; never pass it for Production.

   Do **not** add `AVSERV_SERVICE_JWT_SIGNING_KEY` or `AVSERV_FAILOVER_BASE_URL`
   to Preview. For SAR proof uploads on previews, connect a second Vercel Blob
   store to the Preview environment only.
6. Push any commit to an open PR and sign in to its preview as `you+admin@…`.

### Housekeeping

- `preview` is shared, so an abandoned PR's migration stays on it. When previews
  drift (a migration error in the build log, or stale data), go to the Neon console,
  then `preview` → **Reset from parent**. The next preview build re-applies the
  open PR's migrations.
- After a migration merges to `main`, migrate `preview-seed` too (step 2's
  `db:migrate` line), so resets start current.
- `vercel-dev` (the CI E2E parent) is a separate matter: it's still a branch of
  production, used only by CI.

## Portal maintenance switch

For planned work that takes the signed-in portal down (a database upgrade, a
risky migration). While it's on, every portal route (sign-in, `/settings`,
`/admin`, `/sar`, `/advertiser`…) answers a static **503 "down for
maintenance"** page with `Retry-After`. These stay up throughout: the public
site and store gates (`/`, `/privacy`, `/terms`, `/sms`, `/alerts`, `/support`,
`/account/delete`, …) and `/healthz` / `/readyz`. The switch needs no database
and no redeploy.

**One-time setup:** Vercel → Storage → create a **Global Config** (formerly Edge
Config) store and connect it to `rmdig-portal` for **Production** only. That sets
`GLOBAL_CONFIG` (older stores set `EDGE_CONFIG`; either works). Redeploy once so
the middleware sees the variable.

**Turn it on:** in the store, set the key `portalMaintenance`:

```json
{ "enabled": true, "message": "We're upgrading the database.", "endsAt": "2026-10-04T08:30:00Z" }
```

- `message` (optional, ≤ 300 characters) is public copy: no internal detail,
  and none of the forbidden claims (CLAUDE.md §0).
- `endsAt` (optional, ISO 8601 with offset) is shown in Mountain time and sets
  `Retry-After`.
- It takes effect within about 30 seconds (each Edge instance caches the value).

**Turn it off:** set `"enabled": false` (or delete the key).

**Fails open:** if the store can't be read, or the value doesn't match the shape
above, the portal stays up and the middleware logs
`maintenance.switch_unreadable` / `maintenance.switch_invalid`. So check that a
switch-on actually took: `curl -s -o /dev/null -w '%{http_code}' https://rmdig.ai/settings`
must print `503`.

**Reads:** the switch is read only for portal routes, at most once per 30 s per
Edge instance, to stay inside the Hobby plan's included reads (100k a month).

## Announcements

Banners on signed-in portal pages: `/admin/announcements` (**rmdig_admin only**).

- **Write:** message (≤ 300 characters), type (Information / Maintenance /
  Incident), one or more audiences, optional start and end in **Mountain time**.
  The form previews the banner as you type.
- **Audiences overlap:** Everyone signed in, Regular users (no SAR, advertiser or
  staff role), SAR organization members, SAR organization admins (the `admin`
  role in any SAR org; also counted as members), Advertisers, rmdig staff. A
  viewer sees an announcement if they're in any of its audiences. Banners show
  on the next portal visit; nothing is emailed.
- **Public copy:** the server refuses the forbidden claims (CLAUDE.md §0:
  "always", "real-time", "24/7"…). Write what's happening and when, nothing
  internal.
- **Preview as:** shows the banners a regular user, SAR member, advertiser or
  staff member sees right now. It renders banners only: no one's data, no
  permission change.
- **End now** stops one early. Creating and ending are recorded in
  `announcement_log` with who did it.
- Announcements live in the portal database, so they can't announce the
  database being down. For that, use the maintenance switch (above) and the
  status page.

## Outages and rollback

**Detect.** Two probes, two meanings:

| URL | 200 means | Pages you? |
|---|---|---|
| `/healthz` | the deployment is running | no, it never touches the database |
| `/readyz` | the database answers **and** holds every migration this build ships | yes: UptimeRobot monitor, push alerts |

`/readyz` returns 503 with `checks.database` (`ok` / `unreachable`) and
`checks.schema` (`ok` / `behind` / `unknown`). The cause is in the logs
(`readyz.database_unreadable`, `readyz.schema_behind`), never in the body.

**Diagnose.**
```bash
vercel logs --environment production --level error --since 1h --no-branch -x
vercel env ls production | grep -E ' DATABASE_URL '   # exactly that name (the DATABSE_URL outage)
curl -s https://rmdig.ai/readyz
```
- `database: ok, schema: behind` with the migrations table **missing** (log
  `readyz.database_unreadable`, code `42P01`): the URL reaches the wrong database.
  Re-pin (see "Connecting to production").
- `database: ok, schema: behind` otherwise (log `readyz.schema_behind`): a
  migration merged before it was applied; run it ("Run a production migration").
- `database: unreachable`: wrong host or credentials (re-pin), or Neon itself;
  check Neon status and the project's compute in the Neon console.

**Roll back a bad deploy.** Vercel → Deployments → the last good production
deployment → **Instant Rollback** (or `vercel rollback <deployment-url>`). It
swaps the alias in seconds and doesn't rebuild. A rollback doesn't undo a
migration: if the bad deploy shipped one, the old code runs against the new
schema, which is the normal state before any merge (§3.8) and is safe for
additive migrations.

**After.** Record the incident in `docs/plans/00_status.md` with the cause and the
lesson, and add any new step here.

**Probe cost.** Neon's free compute suspends after 5 minutes idle. A `/readyz`
probe every 5 minutes keeps it awake around the clock; every 10 minutes keeps
it awake about half the time. Pick the interval against the plan's compute
allowance (infrastructure.md "Maintenance").

## Routine maintenance

See [infrastructure.md](infrastructure.md) §Maintenance for the schedule:
- **Credential rotation** — `RESEND_API_KEY`, `SENTRY_AUTH_TOKEN`,
  `GOOGLE_CLIENT_SECRET`, `NEXTAUTH_SECRET` annually or on suspected compromise.
- **DMARC tightening** — `p=quarantine` → `p=reject` after clean aggregate reports.
- **Neon compute** — free tier auto-suspends after 5 min idle; bump to paid once
  real users are on.
- **Sentry quota** — watch the 5k errors/month free tier during soft launch.
