import { AvServError, findOrCreateAccount } from "../avserv/client";
import { reportError, reportProblem } from "../report-error";

// A drill account on AvServ, made when staff create a drill login or drill
// user (plan 37 §4.11, P7b; owner 2026-11-11). Made before the portal row, so
// a refusal is said on the form and nothing is created. The sign-in map
// (lib/avserv/account-link.ts, P7a) stays as the backstop. AvServ's answers:
// account_agreement.md rev 16 §4.2.

export type DrillAvServAccount = { ok: true; accountId: string } | { ok: false; error: string; field?: "email" };

export const REAL_ACCOUNT_AT_ADDRESS = "This address already has a real AvAI account, so it can't be a drill one. Choose another drill address.";

export async function createDrillAvServAccount(email: string, context: Record<string, unknown>): Promise<DrillAvServAccount> {
  let account: Awaited<ReturnType<typeof findOrCreateAccount>>;
  try {
    account = await findOrCreateAccount(email, { drill: true });
  } catch (err) {
    if (err instanceof AvServError && err.code === "account_drill_immutable") {
      reportProblem("sar.drill.account_refused", "AvServ holds a real account at a drill address", { ...context, code: err.code }, "warning");
      return { ok: false, error: REAL_ACCOUNT_AT_ADDRESS, field: "email" };
    }
    if (err instanceof AvServError && err.code === "drill_support_pending") {
      reportProblem("sar.drill.account_pending", "AvServ can't store drill accounts on every node yet", context, "warning");
      return { ok: false, error: "AvAI can't store drill accounts on every server yet. Try again later." };
    }
    reportError("sar.drill.account_failed", err, context);
    if (err instanceof AvServError && err.status === 403) {
      return { ok: false, error: "AvAI refused to let the portal create drill accounts. Ask AvServ to check the portal key's drill_accounts scope." };
    }
    return { ok: false, error: "Couldn't create the drill account on AvAI. Try again in a moment." };
  }
  // AvServ answered with an account across the line: never store it.
  if (!account.drill) {
    reportProblem("sar.drill.account_not_drill", "AvServ answered a drill account request with a real account", { ...context, accountId: account.accountId });
    return { ok: false, error: REAL_ACCOUNT_AT_ADDRESS, field: "email" };
  }
  return { ok: true, accountId: account.accountId };
}
