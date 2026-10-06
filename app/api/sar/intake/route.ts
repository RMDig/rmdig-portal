import { handleIntake } from "@/lib/sar/intake-handler";

// AvServ → portal SAR intake, live messages only (lib/sar/intake-handler.ts).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return handleIntake(req, "live");
}
