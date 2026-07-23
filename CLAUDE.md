# CLAUDE.md — rmdig-portal Systems-Engineering Standards

Operating manual for working in this repo. Applies to every session. Read before
editing. Mirrors the AvApp and AvServ `CLAUDE.md` standards, adapted for a
Next.js web portal. Companion documents: [CLAUDE_BOOTSTRAP.md](CLAUDE_BOOTSTRAP.md)
(what this repo is, stack, milestones), [docs/runbook.md](docs/runbook.md)
(operator tasks), [docs/infrastructure.md](docs/infrastructure.md) (what's
provisioned).

---

## 0. Safety-Adjacent + Compliance-Bearing Context (read first, every time)

The portal is not the safety spine — AvServ's watchdog is — but three things
here are load-bearing for the platform's safety and legal story:

- **SAR org verification.** Approved SAR orgs receive safety-of-life alert
  routing. An unverified org reaching `approved` is a critical failure mode.
  **Manual operator approval is non-negotiable** — never automate it, never
  add a path around the approval queue.
- **Public safety-claim copy.** Every public page is a claim surface under
  AvApp doc 16 §6.2. Forbidden at the current beta rung: "always",
  "guaranteed", "real-time", "24/7", "never miss", "fail-safe", "redundant"
  (unqualified), "professional monitoring center", "fully staffed".
  Load-bearing strings live in [lib/legal/compliance-copy.ts](lib/legal/compliance-copy.ts)
  as **verbatim twins** of AvApp `lib/copy/compliance_copy.dart` — edit both
  sides together, never paraphrase at a call site.
  `tests/unit/legal-copy.test.ts` enforces this; keep it green.
- **Privacy + CPA obligations.** `/privacy` must mirror AvApp's
  `ios/Runner/PrivacyInfo.xcprivacy` + Play Data Safety declarations — if a
  data practice changes, both change in the same release. The deletion path
  (`/account/delete` → `deletion_requests`) carries a Colorado Privacy Act
  45-day clock; precise geolocation is sensitive data under the CPA. Legal
  operative text is authored by counsel only — build structure, use
  `[LAWYER]` placeholders (`components/legal/LawyerPlaceholder.tsx`), never
  draft binding language.

On everything else this file's defaults apply; on these three, §0 is the
tie-breaker.

---

## 1. Mindset

Treat every change as a systems-engineering decision, not a point edit.

- Understand the **system** before touching the component. The architecture
  boundaries in [CLAUDE_BOOTSTRAP.md §1](CLAUDE_BOOTSTRAP.md) are the contract;
  the planning docs in `rmdig-ai/docs/plans/` are the source of architectural
  intent. If a change contradicts them, the docs change first (via the user).
- Prefer correctness over cleverness, clarity over brevity.
- "Done" means: works, fits the architecture, has focused tests, passes the
  two-lens review, and won't wake anyone up at 3 a.m.

---

## 2. Session Workflow (mandatory)

1. **Frame the work.** One or two sentences: what and why, referencing the
   relevant plan doc or milestone.
2. **Plan.** Sketch the approach before writing code; use TodoWrite for
   anything non-trivial. Align with the user before large changes.
3. **Implement in small, coherent steps.** Each step leaves the tree
   compiling (`pnpm typecheck` clean).
4. **Focused tests per step** (§4.1).
5. **Two-lens review** — mandatory gate before the pre-PR suite (§5).
6. **Pre-PR gate** (§4.2) — only when the change is believed complete.
7. **Report.** What changed, what's next, file paths.

If a step fails, stop and diagnose; don't forge ahead on a known-broken
intermediate state.

---

## 3. Hard Rules

These are not suggestions.

### 3.1 No band-aids. Ever.

Find the **root cause** and fix it there. Banned moves:

- `try/catch` that swallows an error to make a test pass.
- A `setTimeout`/retry inserted to "fix" a race condition.
- Hardcoding a value to work around config that isn't loading.
- Disabling a lint, test, or type check to make CI green.
- `?? fallback` / optional-chaining guards that mask a bug further up the stack.

Correct flow: reproduce deterministically → trace to origin (read the code,
don't guess) → name the root cause in one sentence → fix at the origin. If the
origin is out of scope, **stop and escalate** — don't band-aid to keep moving.
A forced temporary mitigation is labeled `// BAND-AID:` in code and in the PR
description, with a tracked follow-up.

### 3.2 No silent failures.

Handle what can be handled; **surface** what can't — structured log (pino),
Sentry, and a user-visible error. Silent `catch {}` is banned unless the
swallowed error is genuinely benign and a one-line comment explains why.
Notification side-effects (email fan-out) log failures loudly but don't roll
back the state transition they announce — the DB row is the source of truth
(see `app/(portal)/sar/new/actions.ts` for the canonical pattern).

### 3.3 No dead code, no scope creep.

Remove unused code as you encounter it. Ship the task that was asked;
Phase-gated features (Stripe, payouts, capture review) stay out until their
phase (bootstrap §1).

### 3.4 No secret leakage.

Secrets live in Vercel env vars only; `.env.example` documents names without
values. `lib/env.ts` is the single source of env access — never read
`process.env` elsewhere, **except** in code bundled into the Edge runtime
(see §3.6).

### 3.5 Architecture boundaries (bootstrap §1) hold.

No image bytes in this DB; no cross-service DB access (AvServ/SnowDB only via
their public APIs); no alert-dispatch logic here; migrations are append-only
in production. Reserved vocabulary: the trip-safety lifecycle is
*check out / check in* (`checkouts`, `checked_out_at`, `checked_in_at`);
`session` belongs to Auth.js; no `trip` entity; "heartbeat" and "ping" are
reserved (bootstrap §5).

### 3.6 Edge runtime is DB-free and env-schema-free.

DB-backed sessions are Node-only, so auth/role/MFA gating lives in Node server
components (the portal layout), never middleware. Anything bundled into the
Edge middleware (including `instrumentation.ts` imports like
`sentry.edge.config.ts`) must not import `lib/env` — strict env validation in
the edge bundle took down every route in prod on 2026-07-22.

### 3.7 Public routes stay public.

Everything under `app/(public)/` is a store-submission gate (privacy policy,
terms, support, deletion). It must render with no session, no DB dependency
where avoidable, and must never gain an auth wall or an import of `lib/auth`.

### 3.8 Migrations: prod before merge.

Vercel auto-deploys `main` on merge. A PR that adds a migration has it applied
to the production Neon branch **before** the merge (runbook "Run a production
migration" — get the URL via `neonctl`, not `vercel env pull`, which returns
empty for sensitive vars). Stacked branches keep migration numbering linear
when multiple migration PRs are in flight; whoever merges second regenerates.

---

## 4. Testing Discipline — tests on all functionality

Two modes, explicit boundaries. The standing rule: **every change leaves test
coverage better than it found it.** New functionality ships with its tests in
the same PR — not as a follow-up.

### 4.1 Focused tests (during the session)

- `pnpm test <file>` / `pnpm exec vitest run tests/unit/foo.test.ts` — only
  what exercises the change. Seconds, not minutes.
- `pnpm typecheck` as you go. If `.next/types` references a route you moved,
  `rm -rf .next` and re-run — stale build artifacts, not your bug.

### 4.2 Pre-PR gate (in this order)

1. `pnpm typecheck`
2. `pnpm lint` (eslint is the real gate; do **not** run `prettier --write` —
   the repo has no printWidth config and prettier would reflow everything)
3. `pnpm test` — full vitest tree
4. `pnpm build` — the production build must compile (it's what CI and Vercel run)

Any red → fix at the root (§3.1), then rerun. CI (main-targeted PRs only) runs
typecheck/lint/build + the Playwright e2e-gate; **vitest is local-only**, which
makes running it locally mandatory, not optional.

### 4.3 What must be covered

- **Every server action**: at least one happy-path test and one
  auth-failure/validation-failure test. Failure paths that return errors to the
  user (rate limit, DB failure, email failure) are tested to fail *loud*, not
  silent.
- **Every `lib/` module** with logic (schemas, token primitives, role checks,
  geo lookups): unit tests over its exported surface.
- **Zod schemas** at boundaries: reject cases, not just accept cases.
- **Public-copy discipline**: any new public-facing page or email template is
  added to the `tests/unit/legal-copy.test.ts` scan surface.
- **Cross-service flows** (device-link, and future AvServ/SnowDB integrations):
  a mock-backed Playwright e2e spec; the live variant stays opt-in.
- Unit tests are **pure** — no DB, no network. Mock at the module boundary
  (`vi.mock` of `@/lib/db`, `@/lib/email/send`, `@/lib/rate-limit`; see
  `tests/unit/password-reset-actions.test.ts` for the canonical harness).

---

## 5. Two-Lens Review (mandatory before the pre-PR gate)

Before running the §4.2 gate, stop and perform a written two-lens review — the
architecture and execution lenses in parallel, each producing its own labeled
paragraph. Output goes in the PR description. If either lens raises a blocker,
resolve it before proceeding.

### 5.1 Lens A — Architectural effect

- What does this change touch (routes, server actions, schema, email, auth,
  cross-service clients)?
- Does it respect the bootstrap §1 boundaries and the layering
  (server components → server actions → `lib/` → DB/external APIs)?
- Does it move toward the planning-doc architecture or add debt?
- Does it invalidate an assumption held elsewhere (schema shape, session
  strategy, role model, route table, env contract)?
- New abstraction: justified by ≥ 2 concrete call sites today, or speculative?
- Schema change: is the migration append-only-safe, and does anything else
  read the changed rows?

Produce a paragraph labeled **"Architectural effect:"**.

### 5.2 Lens B — Execution effect

- Does the app still build and boot (`pnpm build`) with a prod-shaped env?
- Do previously-working flows still work end-to-end (sign-up/sign-in + MFA,
  SAR submit → approve, device link, deletion request → confirm)?
- Server/client component split still correct (`'use client'` only where
  hooks/browser APIs demand it)?
- New env vars: added to `lib/env.ts` **and** `.env.example` **and** Vercel?
  Optional-with-fail-loud or required — chosen deliberately?
- Any new runtime dependency (network, external API) that could fail silently?
  Rate limits, timeouts, error surfacing in place?
- Does the change affect the Edge bundle (§3.6) or a public route (§3.7)?

Produce a paragraph labeled **"Execution effect:"**.

A diff that passes both lenses earns the right to run the full gate. A diff
that fails either goes back for another pass.

---

## 6. Git, Branches, PRs

- Feature branches; every merge to `main` goes through a PR, even solo.
  Never commit directly to `main` without explicit user authorization.
- Commits are atomic, present-tense imperative, GPG-signed (YubiKey — retry on
  touch timeout rather than disabling signing).
- PR descriptions include the two-lens review (§5) and a test plan; write
  bodies with `--body-file`.
- Stacked branches when a PR depends on another (especially migration
  numbering).
- **Never** force-push `main`; feature-branch force-pushes only with user
  approval. **Never** `--no-verify`, `--no-gpg-sign`, or lint-disabling to get
  a commit through.
- Destructive ops (`reset --hard`, branch deletes, prod SQL `UPDATE`/`DELETE`)
  require explicit authorization each time; prior authorization does not
  generalize.

---

## 7. Code Standards (TypeScript / Next.js specifics)

- TypeScript strict, `noUncheckedIndexedAccess`, no `any`.
- Zod at every boundary; types via `z.infer`, never hand-written parallels.
- Server Actions for portal-internal mutations; API routes only for other
  services and webhooks.
- Default to server components; data flows down as props.
- Tokens (reset, invite, deletion) are stored **hashed** (SHA-256 for
  high-entropy random; bcrypt is for human passwords only); plaintext lives
  only in the emailed link. Follow `lib/auth/reset-tokens.ts`.
- Rate-limit any unauthenticated write path (`lib/rate-limit.ts`).
- Emails: React Email templates in `lib/email/templates/`, send functions in
  `lib/email/send.ts` — Resend client is lazy and fails loud when unconfigured.
- Comments explain *why*, not *what*; match the surrounding density.
- No new files over ~400 lines; extract.

---

## 8. Production Hygiene

- Prod DB identity and access: see runbook "Connecting to production" —
  `production` branch of Neon project `lingering-waterfall-99928244`, reached
  via `neonctl connection-string`. Verify which branch an env actually reaches
  before trusting integration-injected vars.
- Env changes need a redeploy to take effect (`vercel redeploy <deployment>`).
- After any deploy that touches routing, env, or middleware: verify
  `https://app.rmdig.ai/healthz` and one public + one authed route.
- E2E tooling never points at the prod DB (`E2E_ALLOW_DB=1` guard exists for
  exactly this reason).

---

## 9. Working With the Memory System

The session memory under `~/.claude/projects/…/memory/` is authoritative for
user intent and long-lived decisions. Read first, extend second; update
memories that a session proves wrong.

---

## 10. Escalation

- Ambiguous requirements → ask before writing code.
- A band-aid is tempting → stop and escalate (§3.1).
- A decision contradicts a planning doc → the docs are the contract; file the
  issue rather than silently diverging (bootstrap §10).
- Anything touching SAR approval, public safety copy, or legal text beyond
  structure → §0 applies; confirm with the user.

The cost of a clarifying question is low. The cost of shipping a wrong
assumption is high.
