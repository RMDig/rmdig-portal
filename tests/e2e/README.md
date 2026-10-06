# E2E tests (Playwright)

The device-link flow is the bootstrap §6 gate for P1.3: it drives a real browser
through credentials login → AvServ account map (P-B1) → linked-devices view
(P-B3) → mint a link-code (P-B2).

## One-time setup

```bash
pnpm exec playwright install chromium        # browser binary (not vendored)
```

## Mock suite — the always-on CI gate

Hermetic: runs against the in-process mock AvServ, so it needs no service key or
live AvServ — only a **disposable** Postgres branch. `global-setup` seeds a
verified, non-staff test user and refuses to run unless you affirm the DB is
throwaway.

```bash
DATABASE_URL=<disposable Neon dev/test branch> \
E2E_ALLOW_DB=1 \
pnpm test:e2e
```

`E2E_ALLOW_DB=1` is a required, conscious acknowledgement that `DATABASE_URL` is
disposable — the setup writes to the `users` table. **Never point it at
production.** The web server is booted with `AVSERV_BASE_URL=mock://localhost`
and `MFA_ENFORCEMENT=optional` automatically (see `playwright.config.ts`).

## Live suite — opt-in cross-service check

Runs the same flow against a real AvServ. Requires the operator's service
keypair (Step 0) so the server can sign the service JWT.

```bash
DATABASE_URL=<disposable dev/test branch> \
E2E_ALLOW_DB=1 \
AVSERV_LIVE_E2E=1 \
AVSERV_BASE_URL=<real AvServ base URL> \
AVSERV_SERVICE_JWT_SIGNING_KEY_B64="$(base64 -i key.pem | tr -d '\n')" \
pnpm test:e2e:live
```

The mock suite skips automatically when `AVSERV_BASE_URL` isn't `mock://*`, and
the live suite skips unless `AVSERV_LIVE_E2E=1` — so the wrong suite never runs
against the wrong backend.
