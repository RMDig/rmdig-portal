import { z } from "zod";

// A team's check-out cap (plan 33 D5, 9.7; AvServ sar_team_sync.md §5): the
// most check-outs AvServ binds to the team at once, or no limit. Pure and
// client-safe: the form, the action and the sync body share it.

/** AvServ's range; outside it the whole PUT is 422 capacity_invalid. */
export const MIN_ACTIVE_CHECKOUTS = 1;
export const MAX_ACTIVE_CHECKOUTS = 10_000;

/** The sync revision that carries `maxActiveCheckouts` (sar_team_sync.md §5;
 *  plan 33 §6.2). A revision 1 node ignores the field and would bind without
 *  the cap, so a capped team is held until every node reports this. */
export const SETTINGS_SYNC_REVISION = 2;

/** A count as the team reads it: "10,000". */
export const formatCount = (n: number) => new Intl.NumberFormat("en-US").format(n);

/** The form's field: blank for no limit, else a whole number in AvServ's
 *  range. */
export const capacityFieldSchema = z
  .string()
  .trim()
  .transform((s, ctx): number | null => {
    if (s === "") return null;
    if (!/^\d+$/.test(s)) {
      ctx.addIssue({ code: "custom", message: "Enter a whole number, or leave it blank for no limit." });
      return z.NEVER;
    }
    const n = Number(s);
    if (n < MIN_ACTIVE_CHECKOUTS || n > MAX_ACTIVE_CHECKOUTS) {
      ctx.addIssue({ code: "custom", message: `Enter a number from ${MIN_ACTIVE_CHECKOUTS} to ${formatCount(MAX_ACTIVE_CHECKOUTS)}, or leave it blank for no limit.` });
      return z.NEVER;
    }
    return n;
  });

/** How a cap reads: "25 at once" or "No limit". */
export function capacityText(cap: number | null): string {
  return cap === null ? "No limit" : `${formatCount(cap)} at once`;
}
