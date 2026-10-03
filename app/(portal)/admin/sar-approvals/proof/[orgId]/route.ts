import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { isPlatformStaff } from "@/lib/auth/roles";
import { getProofDoc } from "@/lib/blob/upload";
import { db } from "@/lib/db";
import { sarOrgs } from "@/lib/db/schema";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The only way to open a SAR proof document: staff only, streamed from the
// private Blob store, never cached, and logged. The org row's blob URL never
// reaches the browser.
const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(_req: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const session = await auth();
  const staffId = session?.user?.id;
  if (!staffId || !(await isPlatformStaff(staffId))) {
    return new NextResponse("Not found", { status: 404 });
  }

  const { orgId } = await params;
  if (!UUID.test(orgId)) return new NextResponse("Not found", { status: 404 });

  const [org] = await db
    .select({ url: sarOrgs.proofDocUrl })
    .from(sarOrgs)
    .where(eq(sarOrgs.id, orgId))
    .limit(1);
  if (!org) return new NextResponse("Not found", { status: 404 });

  let doc: Awaited<ReturnType<typeof getProofDoc>>;
  try {
    doc = await getProofDoc(org.url);
  } catch (err) {
    logger.error({ event: "sar.proof.read_failed", staffId, orgId, err });
    return new NextResponse("Couldn't load the document. Try again.", { status: 502 });
  }
  if (!doc) {
    logger.warn({ event: "sar.proof.missing", staffId, orgId });
    return new NextResponse("This document is no longer in storage.", { status: 404 });
  }

  logger.info({ event: "sar.proof.viewed", staffId, orgId });
  return new NextResponse(doc.stream, {
    headers: {
      "content-type": doc.contentType,
      "content-disposition": "inline",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
