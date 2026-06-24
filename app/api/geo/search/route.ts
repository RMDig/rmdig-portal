import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { searchAdmin } from "@/lib/geo/lookup";
import { ADMIN_LEVELS, type AdminLevel } from "@/lib/advertiser/target";

// Typeahead backing the ad target picker's admin selector (AD-P7b, doc 31 §3):
//   GET /api/geo/search?level=state|county|place&q=<text>&state=<USPS>
// Returns matching Census units from the bundled reference data. The data is
// public-domain, but the endpoint is gated to authenticated users so it isn't an
// open geocoder. Read-only; no DB, no user location — advertiser authoring input only.

const isLevel = (v: string | null): v is AdminLevel =>
  v !== null && (ADMIN_LEVELS as readonly string[]).includes(v);

export async function GET(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const level = searchParams.get("level");
  if (!isLevel(level)) {
    return NextResponse.json({ error: "level must be state, county, or place" }, { status: 400 });
  }
  const q = searchParams.get("q") ?? "";
  const state = searchParams.get("state") ?? undefined;

  const results = searchAdmin(level, q, { state });
  return NextResponse.json({ results });
}
