import { NextResponse } from "next/server";

import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  // `||` (not `??`) so that GIT_COMMIT_SHA="" in .env.local doesn't shadow the
  // "unknown" fallback. Vercel sets VERCEL_GIT_COMMIT_SHA automatically in
  // production deploys.
  const commit = env.VERCEL_GIT_COMMIT_SHA || env.GIT_COMMIT_SHA || "unknown";

  return NextResponse.json({ status: "ok", commit });
}
