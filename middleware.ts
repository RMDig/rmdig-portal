import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Why this is so thin: the authoritative MFA-enforcement gate lives in the
// portal layout (a Node server component), because the portal uses DATABASE
// sessions over postgres-js — which can't run in the Edge middleware runtime,
// so middleware can't resolve the session or read mfa_enabled_at/roles here.
//
// All this does is (1) collapse the legacy hosts onto the canonical one and
// (2) forward the request path as `x-pathname` so the layout can tell which
// route is rendering and avoid redirect-looping the user on the enrollment
// page itself. No DB, no auth — cheap and Edge-safe (and per CLAUDE.md §3.6,
// no lib/env import; the host names are public routing config, not secrets).

// One canonical browsing host, matching NEXTAUTH_URL. Auth session cookies
// are host-scoped: with two browsable hosts, a sign-in on one strands its
// session cookie there while Auth.js (anchored to NEXTAUTH_URL) redirects to
// the other — observed in prod 2026-07-25 as "signed in, bounced back to an
// empty sign-in form". 308 preserves method+body, so store-registered
// app.rmdig.ai URLs and API calls keep working through the redirect.
const CANONICAL_HOST = "rmdig.ai";
const LEGACY_HOSTS = new Set(["app.rmdig.ai", "www.rmdig.ai"]);

export function middleware(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  if (LEGACY_HOSTS.has(host)) {
    const url = req.nextUrl.clone();
    url.protocol = "https:";
    url.host = CANONICAL_HOST;
    url.port = "";
    return NextResponse.redirect(url, 308);
  }

  const headers = new Headers(req.headers);
  headers.set("x-pathname", req.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Everything except Next internals, static assets, and the auth API (which
  // must not be perturbed). Dotted paths (files with extensions) are excluded.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/auth|.*\\.).*)"],
};
