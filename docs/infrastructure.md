# rmdig-portal infrastructure

External services provisioned for Phase 1 of `rmdig-portal`. This is a **state-of-the-system** doc — what's set up, where credentials live, how to verify it works. Operational runbooks (how to approve a SAR org, reset MFA, etc.) live in `docs/runbook.md` when P1.5 lands.

The platform-wide architecture docs are canonical in [`rmdig-ai/docs/plans/`](https://github.com/dennys246/rmdig-ai/tree/main/docs/plans), not here.

## Service inventory

| Service | Account / Project | Env vars produced | Purpose |
|---|---|---|---|
| **GitHub** | `dennys246/rmdig-portal` (public) | — | Source of truth, Vercel build trigger, Sentry source-code mapping |
| **Vercel** | Project `rmdig-portal` under team `denny-schaedig-s-projects` | `VERCEL_GIT_COMMIT_SHA` (auto, build-time) | Hosting for Next.js app; deploys `main` to production, every PR to a preview |
| **Neon** | Project linked via Vercel Marketplace ("Neon-managed" path) | `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED` (direct), `POSTGRES_*` family (auto-injected) | Primary Postgres for users, SAR orgs, device links. PostGIS enabled. First migration applied — empty `users` table exists. |
| **Google Cloud Console** | OAuth client for the `rmdig` project | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth sign-in (configured in P1.1) |
| **Resend** | Domain `rmdig.ai` (apex DKIM, `send.rmdig.ai` envelope) | `RESEND_API_KEY`, `RESEND_FROM_EMAIL=noreply@rmdig.ai` | Transactional email — verification links, claim tokens, org approvals |
| **Sentry** | Org `rocky-mountain-digerati`, project `rmdig-portal` | `SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` | Error tracking, source-map upload at build time, GitHub integration for stack-trace source mapping |
| **Cloudflare** | DNS for `rmdig.ai` | — (DNS only) | Hosts apex DNS; `app.rmdig.ai` CNAME → Vercel; SPF/DKIM/DMARC for Proton + Resend |
| **ProtonMail** | Mailbox for `*@rmdig.ai` | — | Human inbox / outbound personal email. Coexists with Resend at the apex via separate DKIM selectors. |

## Domains and DNS

- **`rmdig.ai`** — root domain, served by Cloudflare DNS. MX → Proton. Apex DKIM has both `protonmail._domainkey` (Proton) and `resend._domainkey` (Resend) selectors. Apex SPF: `v=spf1 include:_spf.protonmail.ch ~all` (untouched — Resend uses subdomain envelope).
- **`send.rmdig.ai`** — Resend's envelope subdomain. MX `feedback-smtp.us-east-1.amazonses.com`, SPF `v=spf1 include:amazonses.com ~all`. Bounces land here; users never see it.
- **`app.rmdig.ai`** — CNAME to Vercel (DNS-only / gray cloud, not orange-cloud proxied). Production portal URL.
- **`_dmarc.rmdig.ai`** — `v=DMARC1; p=quarantine; rua=mailto:dennys25@pm.me`. **Tighten to `p=reject` in ~2–4 weeks after monitoring `rua=` reports** (see Maintenance below).

## Where credentials live

| Var | `.env.local` | Vercel: Production | Vercel: Preview | Vercel: Development | Sensitive in Vercel? |
|---|---|---|---|---|---|
| `DATABASE_URL` | dev-branch URL | auto (via Neon integration) | auto (per-PR branch) | auto | yes |
| `NEXTAUTH_URL` | `http://localhost:3000` | `https://app.rmdig.ai` | unset (Auth.js auto-detects) | — | no |
| `NEXTAUTH_SECRET` | hex string | same hex | same hex | same hex | yes |
| `GOOGLE_CLIENT_ID` | yes | yes | yes | yes | no |
| `GOOGLE_CLIENT_SECRET` | yes | yes | yes | — (sensitive blocks Dev) | yes |
| `RESEND_API_KEY` | yes | yes | yes | — | yes |
| `RESEND_FROM_EMAIL` | `noreply@rmdig.ai` | same | same | same | no |
| `SENTRY_DSN` | optional | yes | yes | yes | no |
| `SENTRY_ORG` | — | `rocky-mountain-digerati` | same | same | no |
| `SENTRY_PROJECT` | — | `rmdig-portal` | same | same | no |
| `SENTRY_AUTH_TOKEN` | **never** | yes | yes | — (CI-only) | yes |
| `MFA_ENFORCEMENT` | `admin_only` | `admin_only` (flip to `all` at public launch) | `admin_only` | `admin_only` | no |

`.env.local` is gitignored. `.env.example` documents the contract.

## Verification commands

```bash
# DNS
dig app.rmdig.ai +short                                 # → Vercel CNAME target
dig rmdig.ai TXT +short                                 # SPF (Proton), verification records, no Resend on apex
dig send.rmdig.ai MX +short                             # 10 feedback-smtp.us-east-1.amazonses.com.
dig send.rmdig.ai TXT +short                            # v=spf1 include:amazonses.com ~all
dig resend._domainkey.rmdig.ai TXT +short               # Resend DKIM key
dig _dmarc.rmdig.ai TXT +short                          # exactly one record, p=quarantine, rua=

# Portal liveness
curl https://app.rmdig.ai/healthz                       # {"status":"ok","commit":"<sha>"} once DNS is live
curl https://<vercel-project>.vercel.app/healthz        # same, via Vercel-assigned URL

# Database (idempotent — re-running is safe; applies any pending migrations)
pnpm db:migrate

# Resend (paste the key inline or use $RESEND_API_KEY from .env.local)
curl -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"from":"rmdig <noreply@rmdig.ai>","to":"dennys25@pm.me","subject":"smoke","text":"alive"}'
```

## Local CLI gotchas

`drizzle-kit` does not auto-load `.env.local` — only the Next.js runtime does. We wire `@next/env`'s `loadEnvConfig` into `drizzle.config.ts` so the CLI sees the same env files (in the same precedence order) as the app at runtime. If you ever see `Please provide required params for Postgres driver: url: ''` from `pnpm db:*`, that's the cause — `DATABASE_URL` isn't in `.env.local`, not a Drizzle bug.

## Maintenance

- **DMARC tightening** — currently `p=quarantine`. After 2–4 weeks of clean `rua=` aggregate reports landing in `dennys25@pm.me`, tighten to `p=reject` in Cloudflare DNS. Target window: roughly the P1.5 polish milestone.
- **Sentry rate plan** — free tier ships 5k errors/month. Watch the usage page once P1.5 soft launch begins; bump plan or filter noisy errors via `beforeSend` if approaching.
- **Neon compute auto-suspend** — free-tier compute suspends after 5 min idle. First request after suspend has a 1–3s cold-start latency. Worth a paid plan once real users hit `app.rmdig.ai`.
- **API key rotation** — `RESEND_API_KEY`, `SENTRY_AUTH_TOKEN`, `GOOGLE_CLIENT_SECRET`, and `NEXTAUTH_SECRET` should each be rotated annually or after any suspected compromise. Update both `.env.local` and Vercel env in one sitting.
- **Google OAuth redirects** — three URIs registered (`localhost:3000`, `*.vercel.app`, `app.rmdig.ai`). If the Vercel team slug changes, the `*.vercel.app` URI breaks; add the new one before deleting the old.

## What's NOT set up (deferred to later phases)

- **Vercel Blob** (P1.4 — SAR proof-doc uploads). Token not yet provisioned.
- **AvServ peer JWT signing key** (P1.3 — device-link S2S). Hand-off coordinated offline when AvServ ships the `PATCH /v1/internal/devices/:id` endpoint.
- **Apple Sign-In** (v1.1+). Needs $99/yr Apple Developer account.
- **Stripe Connect** (Phase 4 — payouts). Deliberately out of Phase 1 scope.
