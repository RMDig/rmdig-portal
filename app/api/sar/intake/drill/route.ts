import { handleIntake } from "@/lib/sar/intake-handler";

// AvServ → portal SAR intake for drills: AvServ's AVSERV_SAR_DRILL_SINK_URL.
// Accepts only drill: true messages (lib/sar/intake-handler.ts); they're
// stored and shown as drills, and never email anyone.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return handleIntake(req, "drill");
}
