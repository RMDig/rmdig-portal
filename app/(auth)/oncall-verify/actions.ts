"use server";

import { clientIp } from "@/lib/client-ip";
import { logger } from "@/lib/logger";
import { incrementRateLimit } from "@/lib/rate-limit";
import { reportError } from "@/lib/report-error";
import { confirmOncallLink, ONCALL_LINK_PROBLEM } from "@/lib/sar/oncall-confirm";
import { syncSarOrg } from "@/lib/sar/sync";

// Confirm a team's on-call address from the link sent to it (plan 33 9.10).
// No sign-in: whoever reads that inbox confirms it. Unauthenticated, so it's
// rate-limited by IP; the token is 256 bits, so guessing one isn't the risk.

const CONFIRM_IP_RATE_LIMIT = { limit: 20, windowSec: 60 * 60 };

export type OncallConfirmResult = { ok: true; teamName: string; address: string } | { ok: false; error: string };

export async function confirmOncallEmailAction(_prev: OncallConfirmResult | null, formData: FormData): Promise<OncallConfirmResult> {
  const ip = await clientIp();
  if (!(await incrementRateLimit(`oncall-confirm-ip:${ip}`, CONFIRM_IP_RATE_LIMIT)).allowed) {
    logger.warn({ event: "sar.oncall.confirm_rate_limited" });
    return { ok: false, error: "Too many attempts. Try again in an hour." };
  }
  const token = String(formData.get("token") ?? "");
  let link: Awaited<ReturnType<typeof confirmOncallLink>>;
  try {
    link = await confirmOncallLink(token);
  } catch (err) {
    logger.error({ event: "sar.oncall.confirm_failed", err });
    return { ok: false, error: "Couldn't confirm the address. Try again in a moment." };
  }
  if (!link.ok) return { ok: false, error: ONCALL_LINK_PROBLEM[link.reason] };
  logger.info({ event: "sar.oncall.confirmed", orgId: link.orgId });

  // Tell AvServ after the address is recorded: the confirmed channel goes in
  // the next sync. A node's answer is shown to staff, never undone into this.
  try {
    await syncSarOrg(link.orgId);
  } catch (err) {
    reportError("sar.sync.failed", err, { orgId: link.orgId, decision: "oncall_confirmed" });
  }
  return { ok: true, teamName: link.teamName, address: link.address };
}
