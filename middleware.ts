import { createClient } from "@vercel/global-config";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { buildCsp, MAINTENANCE_CSP, makeNonce, sentryReportUri } from "@/lib/csp";
import { maintenancePage, readSwitch, retryAfterSeconds, staysUp } from "@/lib/maintenance/portal-switch";

// Why this is so thin: the authoritative MFA-enforcement gate lives in the
// portal layout (a Node server component), because the portal uses DATABASE
// sessions over postgres-js — which can't run in the Edge middleware runtime,
// so middleware can't resolve the session or read mfa_enabled_at/roles here.
//
// All this does is (1) collapse the legacy hosts onto the canonical one,
// (2) serve the planned-maintenance page for portal routes while the operator's
// switch is on (lib/maintenance/portal-switch.ts), and (3) forward the request
// path as `x-pathname` so the layout can tell which route is rendering and
// avoid redirect-looping the user on the enrollment page itself, and (4) give
// every page a fresh CSP nonce (lib/csp.ts). No DB, no auth — cheap and Edge-safe (and per CLAUDE.md §3.6,
// no lib/env import; the host names are public routing config, not secrets).

// One canonical browsing host, matching NEXTAUTH_URL. Auth session cookies
// are host-scoped: with two browsable hosts, a sign-in on one strands its
// session cookie there while Auth.js (anchored to NEXTAUTH_URL) redirects to
// the other — observed in prod 2026-07-25 as "signed in, bounced back to an
// empty sign-in form". 308 preserves method+body, so store-registered
// app.rmdig.ai URLs and API calls keep working through the redirect.
const CANONICAL_HOST = "rmdig.ai";
const LEGACY_HOSTS = new Set(["app.rmdig.ai", "www.rmdig.ai"]);

// Vercel sets GLOBAL_CONFIG when a Global Config store is connected; stores
// connected before the rename set EDGE_CONFIG. Read process.env directly: this
// is the Edge bundle (CLAUDE.md §3.6). Unset (local, CI, previews without a
// store) means the switch is off.
const configConnection = process.env.GLOBAL_CONFIG || process.env.EDGE_CONFIG;
const configClient = configConnection ? createClient(configConnection) : null;

// Report-Only for its first week (owner decision S-D9); enforcing it is this
// one line, "Content-Security-Policy" (runbook "Content-Security-Policy").
const CSP_HEADER = "Content-Security-Policy-Report-Only";

// CSP reports go to Sentry from production only: previews and local dev show
// violations in the browser console, and don't spend the Sentry quota.
const cspReportUri =
  process.env.VERCEL_ENV === "production"
    ? sentryReportUri(process.env.NEXT_PUBLIC_SENTRY_DSN, "production", process.env.VERCEL_GIT_COMMIT_SHA)
    : undefined;

export async function middleware(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  if (LEGACY_HOSTS.has(host)) {
    const url = req.nextUrl.clone();
    url.protocol = "https:";
    url.host = CANONICAL_HOST;
    url.port = "";
    return NextResponse.redirect(url, 308);
  }

  if (configClient && !staysUp(req.nextUrl.pathname)) {
    const sw = await readSwitch((key) => configClient.get(key));
    if (sw?.enabled) {
      return new NextResponse(maintenancePage(sw), {
        status: 503,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "retry-after": String(retryAfterSeconds(sw, new Date())),
          "cache-control": "no-store",
          "content-security-policy": MAINTENANCE_CSP,
        },
      });
    }
  }

  const headers = new Headers(req.headers);
  headers.set("x-pathname", req.nextUrl.pathname);
  // Where a signed-out visitor was going, so the portal layout can send them
  // back after sign-in (lib/auth/return-to.ts validates it there).
  headers.set("x-return-to", req.nextUrl.pathname + req.nextUrl.search);

  // Next reads the nonce from the request's CSP header (either name) and puts
  // it on its own scripts; the response header is what the browser checks.
  const csp = buildCsp({
    nonce: makeNonce(),
    dev: process.env.NODE_ENV === "development",
    sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    reportUri: cspReportUri,
  });
  headers.set(CSP_HEADER, csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set(CSP_HEADER, csp);
  if (cspReportUri) res.headers.set("Reporting-Endpoints", `csp="${cspReportUri}"`);
  return res;
}

export const config = {
  // Everything except Next internals, static assets, and the auth API (which
  // must not be perturbed). Dotted paths (files with extensions) are excluded.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/auth|.*\\.).*)"],
};
