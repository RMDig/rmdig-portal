import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { navViewer } from "@/lib/nav/viewer";

// The signed-in viewer's header tabs for the public pages, which can't read
// the session themselves (CLAUDE.md §3.7). Signed out answers
// { viewer: null }; a failure answers 500 and the header stays signed out,
// so a public page never breaks over it.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET() {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.email) return NextResponse.json({ viewer: null }, { headers: NO_STORE });
  try {
    return NextResponse.json({ viewer: await navViewer(user.id, user.email) }, { headers: NO_STORE });
  } catch (err) {
    logger.error({ event: "nav.viewer_failed", userId: user.id, err });
    return NextResponse.json({ error: "unavailable" }, { status: 500, headers: NO_STORE });
  }
}
