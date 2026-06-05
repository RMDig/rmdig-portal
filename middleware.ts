import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Why this is so thin: the authoritative MFA-enforcement gate lives in the
// portal layout (a Node server component), because the portal uses DATABASE
// sessions over postgres-js — which can't run in the Edge middleware runtime,
// so middleware can't resolve the session or read mfa_enabled_at/roles here.
//
// All this does is forward the request path as `x-pathname` so the layout can
// tell which route is rendering and avoid redirect-looping the user on the
// enrollment page itself. No DB, no auth — cheap and Edge-safe.
export function middleware(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set("x-pathname", req.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Everything except Next internals, static assets, and the auth API (which
  // must not be perturbed). Dotted paths (files with extensions) are excluded.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/auth|.*\\.).*)"],
};
