# 07 — rmdig-portal Bootstrap

> **Move this file** to the new `rmdig-portal` repo as `CLAUDE_BOOTSTRAP.md` when initializing it. This document is the starting brief for anyone (human or coding agent) picking up Phase 1 cold.

## 0 — What this repo is

`rmdig-portal` is the user-facing Next.js application served at `app.rmdig.ai`. It is one of four services in the rmdig platform:

- **rmdig-portal** (this repo) — user accounts, SAR org management, dashboards, eventually capture review and payouts
- **AvServ** (`github.com/dennys246/AvServ`) — Go safety watchdog, alert dispatch, check-ins
- **SnowDB** (does not exist yet) — capture storage, novelty scoring, review queue backend, DataLedger source of truth
- **AvAI / snowGAN** — offline ML training pipelines, publish models to HuggingFace Hub

**Authoritative planning docs live in the `rmdig-ai` repo** at `docs/plans/`:
- [00 Platform architecture](https://github.com/dennys246/rmdig-ai/blob/main/docs/plans/00_platform_architecture.md)
- [01 Accounts and orgs](https://github.com/dennys246/rmdig-ai/blob/main/docs/plans/01_accounts_and_orgs.md)
- [02 Data contribution](https://github.com/dennys246/rmdig-ai/blob/main/docs/plans/02_data_contribution.md)
- [03 SAR workflow](https://github.com/dennys246/rmdig-ai/blob/main/docs/plans/03_sar_workflow.md)
- [04 Payments and legal](https://github.com/dennys246/rmdig-ai/blob/main/docs/plans/04_payments_and_legal.md)
- [05 Ledgers](https://github.com/dennys246/rmdig-ai/blob/main/docs/plans/05_ledgers.md)
- [06 Phase 1 migration](https://github.com/dennys246/rmdig-ai/blob/main/docs/plans/06_phase1_migration.md) ← **read this first**

This bootstrap is the operational complement to doc 06.

## 1 — Architectural constraints (do not violate)

These are the boundaries the platform's reliability story depends on. Don't relax them without changing the planning docs first.

1. **No image bytes stored in this repo's database.** Captures go from AvApp to SnowDB object storage directly. The portal only references them.
2. **No direct database access across services.** rmdig-portal reads AvServ and SnowDB only through their public APIs. Never connect to another service's Postgres.
3. **No silent failures.** Echoing AvServ's principle: if a Stripe call, an S2S call, or a critical job fails, surface it loudly (Sentry + structured log + user-visible error). Don't catch-and-swallow.
4. **No alert dispatch logic here.** Alerts fire from AvServ's watchdog. The portal shows alert *history* later (Phase 3+); it does not decide when alerts fire.
5. **No Stripe, no payouts, no capture review UI in Phase 1.** Phase 1 ships auth + device linking + SAR onboarding only. Resist scope creep.
6. **No production secrets in code or in git history.** All secrets via Vercel env vars; `.env.example` documents what's needed without values.
7. **Migrations are append-only in production.** Drizzle Kit generates migrations; review every one before merging. Never edit a migration that has run in production.

## 2 — Tech stack and accounts needed

### Stack

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node.js 20 LTS | Vercel-compatible |
| Package manager | pnpm | Faster, stricter than npm |
| Framework | Next.js 15 (App Router) | React 19, Server Actions |
| Language | TypeScript strict mode | `noUncheckedIndexedAccess` enabled |
| Styling | Tailwind v4 | PostCSS pipeline, not CDN |
| UI primitives | shadcn/ui | Copy-in, no runtime dep |
| Forms | React Hook Form + Zod | Zod schemas shared with server actions |
| Auth | Auth.js v5 | Credentials + Google OAuth, Drizzle adapter |
| Database | Postgres on Neon | PostGIS extension enabled |
| ORM | Drizzle ORM + Drizzle Kit | SQL-first, PostGIS via raw SQL |
| Email | Resend | Transactional + React Email templates |
| Object storage | Vercel Blob | SAR proof-doc uploads in Phase 1 |
| Maps | MapLibre GL + Terra Draw | Polygon drawing for SAR regions |
| Error tracking | Sentry | Errors and performance |
| Logging | pino | Structured JSON to Vercel |
| Testing | Vitest + Playwright | Unit + E2E |

### External accounts to provision before starting

- [ ] **GitHub repo** — `rmdig-portal` under your account or org
- [ ] **Vercel project** — connected to the repo
- [ ] **Neon project** — `rmdig-portal`, with `main` and a `dev` branch
- [ ] **Google Cloud Console OAuth client** — credentials for the OAuth provider
- [ ] **Resend account** — domain verification for `noreply@rmdig.ai`
- [ ] **Sentry project** — Next.js project type
- [ ] **Cloudflare DNS** — add CNAME `app.rmdig.ai` → Vercel target

Capture the corresponding env vars in `.env.local` and Vercel project settings:

```
DATABASE_URL=                              # Neon
NEXTAUTH_URL=                              # https://app.rmdig.ai or http://localhost:3000
NEXTAUTH_SECRET=                           # openssl rand -hex 32
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
RESEND_API_KEY=
RESEND_FROM_EMAIL=noreply@rmdig.ai
SENTRY_DSN=
BLOB_READ_WRITE_TOKEN=                     # Vercel Blob
AVSERV_BASE_URL=                           # https://avserv-1.rmdig.ai (or mock for dev)
AVSERV_PEER_JWT_SIGNING_KEY=               # private key for outbound S2S to AvServ
AVSERV_DEVICE_JWT_PUBLIC_KEY=              # for local verification of device JWTs
MFA_ENFORCEMENT=optional                   # 'optional' | 'admin_only' | 'all'
```

`MFA_ENFORCEMENT` is the runtime knob for the gate described in §4: `optional` during dev/soft-launch, `admin_only` is the default for platform roles, `all` flips on at public launch.

## 3 — First-day commands

```bash
# Create and initialize the repo
gh repo create rmdig-portal --private --clone
cd rmdig-portal
pnpm create next-app@latest . --typescript --tailwind --app --no-src-dir \
  --import-alias "@/*" --use-pnpm

# Add core dependencies
pnpm add drizzle-orm postgres
pnpm add -D drizzle-kit
pnpm add next-auth@beta @auth/drizzle-adapter
pnpm add bcryptjs zod react-hook-form @hookform/resolvers
pnpm add resend react-email @react-email/components
pnpm add @sentry/nextjs pino
pnpm add maplibre-gl
pnpm add @vercel/blob
pnpm add otplib qrcode             # MFA

# Dev tooling
pnpm add -D @types/bcryptjs @types/qrcode vitest @vitejs/plugin-react
pnpm add -D @playwright/test
pnpm add -D eslint-config-next prettier prettier-plugin-tailwindcss

# shadcn primitives (interactive)
pnpm dlx shadcn@latest init
pnpm dlx shadcn@latest add button input form card dialog dropdown-menu

# Sentry wizard
pnpm dlx @sentry/wizard@latest -i nextjs

# First commit
git add .
git commit -m "Initial Next.js scaffold with Drizzle, Auth.js, shadcn"
git push -u origin main
```

After this, configure Vercel to point at the repo, add env vars, and the first deploy should work. Then proceed to P1.0 below.

## 4 — Phase 1 milestones with acceptance criteria

Follow [06_phase1_migration.md](https://github.com/dennys246/rmdig-ai/blob/main/docs/plans/06_phase1_migration.md) for the detailed plan. Acceptance criteria for each milestone:

### P1.0 — Skeleton up
- [ ] Repo created, Vercel deploy live at a Vercel-generated URL
- [ ] `app.rmdig.ai` CNAME resolves to the Vercel deploy
- [ ] Neon database connected, first migration applied (an empty `users` table is fine)
- [ ] `/healthz` route returns 200 with `{ status: "ok", commit: <sha> }`
- [ ] Sentry receives a deliberate test error

### P1.1 — Auth working
- [ ] Sign-up form creates a user, sends verification email via Resend
- [ ] Verification link marks `email_verified_at`, redirects to dashboard
- [ ] Google OAuth sign-in works end-to-end
- [ ] Sign-in / sign-out / password reset all functional
- [ ] Sessions persist across browser restart (30d expiry, rolling refresh)
- [ ] Rate limiting on sign-in attempts (5 fails / 15 min per email)

### P1.2 — Roles + workspace shell
- [ ] `user_platform_roles` table seeded with your account as `rmdig_admin`
- [ ] Workspace layout renders role-appropriate nav (Settings always; Admin only if platform role)
- [ ] `/settings/mfa/enroll` flow generates QR, verifies TOTP, generates recovery codes
- [ ] MFA enforcement middleware respects `MFA_ENFORCEMENT` env var
- [ ] Account settings page (display name, password change, MFA management)

### P1.3 — Device linking
- [ ] `/settings/devices` lists currently linked devices for the user
- [ ] "Add device" generates a claim token, shows QR + alphanumeric code
- [ ] `POST /api/device-link/consume` validates token, verifies device JWT locally, calls AvServ S2S, writes `device_links` row
- [ ] Linked device appears in `/settings/devices` immediately
- [ ] Unlink action removes `device_links` row and clears `user_id` on AvServ device
- [ ] **External:** AvServ has shipped `PATCH /v1/internal/devices/:id` and published device JWT verification material
- [ ] **External:** AvApp v1.5 can scan QR / enter code and call the consume endpoint

For dev work before AvServ is ready: implement a mock AvServ client behind `AVSERV_BASE_URL=mock://localhost` that simulates the S2S responses.

### P1.4 — SAR org onboarding
- [ ] PostGIS extension enabled on Neon production branch
- [ ] `/sar/new` form: name, contact info, MapLibre polygon-draw for region, proof-doc upload to Vercel Blob, TOS acknowledgments
- [ ] Submission creates `sar_orgs` row with status `pending`, creator added as `admin` in `org_memberships`, email to `rmdig_admin` users + submitter
- [ ] `/admin/sar-approvals` table lists pending orgs with region preview, proof doc link, action buttons
- [ ] Approve / Reject / Request-changes actions update status, log to `sar_org_status_log`, email submitter
- [ ] Approved org admin can invite members at `/sar/[orgId]/members`; invitation token landing page accepts membership
- [ ] PostGIS query verified: given a GPS point, return all `approved` orgs whose `region_geom` contains it (needed by AvServ later, but verify the query works now)

### P1.5 — Polish + ship
- [ ] All email templates use React Email and render correctly in Gmail, Apple Mail, Outlook
- [ ] Sentry captures unhandled errors and surfaces them with source maps
- [ ] Marketing site (`rmdig.ai`) has a banner / nav link pointing to `app.rmdig.ai`
- [ ] Internal soft launch: you and 3-5 trusted SAR org admins sign up, link devices (once AvServ is ready), submit org applications, complete the full flow
- [ ] Documented runbook for common operator tasks (approve org, reset MFA, etc.) in `docs/runbook.md` in this repo
- [ ] **MFA enforcement flipped to `all`** once ready for public launch

## 5 — Coding conventions

- **TypeScript strict** with `noUncheckedIndexedAccess`. No `any`.
- **Zod schemas at all boundaries** — form validation, server action input, external API responses. Generate types from Zod with `z.infer`, do not hand-write parallel types.
- **Server Actions over API routes** for portal-internal mutations. API routes are reserved for endpoints called by other services (AvApp's `/api/device-link/consume`, webhooks).
- **Component file layout:** `components/<domain>/<ComponentName>.tsx`. One default export per file. Co-locate small helpers; lift to `lib/` when shared.
- **Server vs client components:** default to server. Mark `'use client'` only when actually using hooks or browser APIs. Pass server-fetched data down as props rather than fetching client-side where possible.
- **No silent catches.** `try { ... } catch (e) { /* nothing */ }` is banned. Either handle and log, or let it bubble.
- **Migrations:** one Drizzle Kit migration per logical schema change. Never edit a migration after it has merged to main. Name them descriptively.
- **Commits:** small, focused, present-tense imperative ("Add device link claim endpoint"). Conventional Commits not required but welcome.
- **PRs:** every merge to main goes through a PR. Even solo. Vercel preview deploys give you a real environment to QA against.

## 6 — Testing

- **Vitest** for unit tests — permission checks, Zod schemas, pure helpers. `tests/unit/*.test.ts`.
- **Playwright** for E2E — sign-up flow, device-link flow, SAR org submission. `tests/e2e/*.spec.ts`. Runs against the Vercel preview URL in CI.
- **Coverage targets:** not enforced numerically. Required: every server action has at least one happy-path test and one auth-failure test.
- **The device-link flow must have a full E2E test** before P1.3 is marked done. It crosses the most service boundaries and is the highest risk for regression.

## 7 — Cross-repo coordination

| Need | Who owns it | How to coordinate |
|---|---|---|
| AvServ `PATCH /v1/internal/devices/:id` | AvServ repo | File issue with API contract spec, link this bootstrap doc |
| AvServ device JWT public key publication | AvServ repo | Same issue |
| Peer JWT signing keys for rmdig-portal | AvServ repo (key custody) | Coordinate offline; do not check keys into either repo |
| AvApp QR scan + link consume call | AvApp repo, v1.5 milestone | File issue referencing this bootstrap §P1.3 |
| Lawyer TOS language | external | Until reviewed, ship with placeholder text + a "DRAFT — pending legal review" banner |
| SnowDB project standup | does not exist yet | Bootstrap deferred to Phase 2 |

For cross-repo issues, prefer one issue per repo with reciprocal links rather than a single issue spanning repos.

## 8 — Daily workflow

```bash
# Morning
git checkout main && git pull
gh pr list                          # see what's in flight

# Start work on something
git checkout -b <descriptive-branch>
pnpm dev                            # local dev server at :3000
pnpm db:studio                      # Drizzle Studio for schema inspection

# Schema change
# Edit lib/db/schema.ts
pnpm drizzle-kit generate
pnpm drizzle-kit migrate            # against local Neon dev branch

# Before pushing
pnpm lint && pnpm typecheck && pnpm test
git push -u origin <branch>
gh pr create                        # open PR, get Vercel preview URL
```

## 9 — Where decisions go when they evolve

- **Code-level decisions** that affect only this repo → ADR in `docs/adr/NNN-title.md`
- **Cross-service decisions** (architecture, schema, contracts) → update the relevant doc in `rmdig-ai/docs/plans/` and link from this repo
- **Open questions discovered during build** → GitHub issue tagged `question`
- **Anything ledger-related** → must be reflected in `rmdig-ai/docs/plans/05_ledgers.md` before merging

The planning docs in `rmdig-ai/docs/plans/` are the source of truth for architectural intent. This repo's `docs/` is for implementation-level decisions only.

## 10 — When stuck, ask

If a decision needs to be made that isn't covered by the planning docs:

1. Check open questions sections in `rmdig-ai/docs/plans/*.md` — it may already be flagged for deferral.
2. If genuinely new, open a GitHub issue describing the decision needed, the options, and your recommended choice.
3. Do not silently pick a default that contradicts the planning docs. The docs are the contract.

If something feels architecturally wrong while building it, that's signal — stop, check the planning docs, file an issue. The platform's reliability and trust model depend on the boundaries holding.
