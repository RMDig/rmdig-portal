import { handleIntake } from "@/lib/sar/intake-handler";

// AvServ → portal SAR intake for drills: AvServ's AVSERV_SAR_DRILL_SINK_URL.
// Accepts only drill: true messages (lib/sar/intake-handler.ts); they're
// stored and shown as drills. Their team email goes only to the drill team's
// drill logins, marked [DRILL] (plan 37 DR2, lib/sar/alert-notify.ts).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return handleIntake(req, "drill");
}
