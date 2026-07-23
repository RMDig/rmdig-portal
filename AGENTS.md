# AGENTS.md — rmdig-portal

Instructions for any coding agent working in this repository. The canonical,
full operating manual is **[CLAUDE.md](CLAUDE.md)** — read it before editing;
this file is the condensed contract so no agent can claim it wasn't told.

## Read first

1. [CLAUDE.md](CLAUDE.md) — engineering standards (this file defers to it).
2. [CLAUDE_BOOTSTRAP.md](CLAUDE_BOOTSTRAP.md) — what this repo is, stack,
   architecture boundaries (§1), coding conventions (§5).
3. [docs/runbook.md](docs/runbook.md) — operator tasks, production DB access.

## Non-negotiables (summary — full text in CLAUDE.md)

- **Safety/compliance context (§0):** SAR org approval is manual, always.
  Public copy obeys the AvApp doc 16 §6.2 forbidden-phrase list; load-bearing
  strings are verbatim twins in `lib/legal/compliance-copy.ts` and are
  test-enforced. Legal operative text comes from counsel only — `[LAWYER]`
  placeholders, never model-drafted binding language. `/privacy` must mirror
  AvApp's privacy manifest; the deletion path carries a CPA 45-day clock.
- **No band-aids** — root-cause fixes only; temporary mitigations are labeled
  `// BAND-AID:` with a tracked follow-up.
- **No silent failures** — surface to pino + Sentry + the user.
- **Boundaries hold** — no cross-service DB access, no image bytes here, no
  alert logic here; Edge bundle never imports `lib/env` or touches the DB;
  routes under `app/(public)/` never gain an auth dependency.
- **Migrations** are append-only and applied to production **before** the PR
  merges (Vercel auto-deploys `main`).

## Workflow

Frame → plan → small compiling steps → focused tests → **two-lens review**
(written "Architectural effect:" + "Execution effect:" paragraphs in the PR
description) → pre-PR gate → report. The pre-PR gate, in order:

```bash
pnpm typecheck
pnpm lint        # eslint is the gate; never run prettier --write
pnpm test        # full vitest tree — CI does NOT run it, so you must
pnpm build
```

## Testing standard — tests on all functionality

New functionality ships with its tests in the same PR. Minimum bar:

- Every server action: happy path + auth/validation failure + loud failure
  paths (rate limit, DB error, email error).
- Every `lib/` module with logic: unit tests over its exported surface.
- Zod schemas: reject cases, not just accept cases.
- New public pages/emails: added to the `tests/unit/legal-copy.test.ts`
  forbidden-phrase scan.
- Unit tests are pure (no DB/network); mock at module boundaries — see
  `tests/unit/password-reset-actions.test.ts` for the canonical harness.

## Git

Feature branches; PR for every merge to `main` (even solo); atomic signed
commits; PR bodies via `--body-file` and containing the two-lens review + test
plan; no force-push to `main`, no `--no-verify`, no disabling checks to go
green. Destructive operations require explicit user authorization each time.
