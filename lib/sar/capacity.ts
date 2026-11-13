import { z } from "zod";

// [COUNSEL]: team-facing wording (plan 33 §6.9 F3). A change here goes to
// counsel too.
// A team's check-out settings (AvServ sar_team_sync.md §5): the most
// check-outs AvServ binds to the team at once, or no limit (plan 33 D5, 9.7),
// and who may name it (D4, 9.8). Pure and client-safe: the forms, the actions
// and the pages share it.

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

/** Who may name the team, as the team reads it. */
export const MODE_TEXT = {
  open: "anyone who accepts your terms",
  confirm_first: "only people your team approves",
} as const;

/** How a cap reads: "25 at once" or "No limit". */
export function capacityText(cap: number | null): string {
  return cap === null ? "No limit" : `${formatCount(cap)} at once`;
}
