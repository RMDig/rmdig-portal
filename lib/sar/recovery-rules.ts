import type { Remedy } from "../avserv/sar-teams";

// [COUNSEL]: team-facing wording (plan 33 §6.9 F3), for counsel's review before
// the first real team. A change here goes to counsel too.
//
// What a team is told when an AvAI server can't send it alerts (plan 33 §6.9
// F4; AvServ sar_team_sync.md §5.4, plan 41 §17.13), and when its admins are
// emailed about it. Pure and client-safe: the team's banner, the staff row and
// the email read the same words.

export interface RemedyCopy {
  /** What's wrong and what fixes it, in the team's terms. */
  text: string;
  /** The team page that fixes it, relative to /sar/<orgId>; null when only rmdig staff can. */
  page: "terms" | "leave" | null;
}

export const REMEDY_COPY: Record<Remedy, RemedyCopy> = {
  reverify_channel: {
    text: "A channel your terms list isn't confirmed on this server: for example, email to your on-call address bounced. Confirm your on-call email again on the Terms page.",
    page: "terms",
  },
  update_terms: {
    text: "Your published terms list no channel this server can send to. Publish terms that do, on the Terms page.",
    page: "terms",
  },
  renew_verification: {
    text: "Your patrol's yearly verification is due. rmdig staff verify it by calling your ski area; contact rmdig support if you haven't heard from us.",
    page: null,
  },
  text_start: {
    text: "Your team's number replied STOP to AvAI's texts. Text START from it to get texts again.",
    page: null,
  },
  resync: {
    text: "This server is missing part of your team's setup. rmdig staff have been told and will send it again.",
    page: null,
  },
  undo_leaving: {
    text: "Your team gave its leaving notice, so AvAI doesn't offer it to users. Undo the notice on the Leaving page to take part again.",
    page: "leave",
  },
  contact_staff: {
    text: "Contact rmdig support to find out what your team needs to do.",
    page: null,
  },
};

export const waitingText = (n: number) =>
  `This server is holding ${n} alert${n === 1 ? "" : "s"} for your team until this is fixed; ${n === 1 ? "it is" : "they are"} sent as soon as it is.`;

export interface NodeRecovery {
  node: string;
  remedy: Remedy | null;
  waitingAlerts: number | null;
  remedyNotified: string | null;
}

/** Whether a node's remedy is news the team's admins should be emailed: the
 *  team is active (approved), or leaving with a problem other than the notice
 *  it gave itself, and this remedy isn't the one already emailed. A suspended
 *  or withdrawn team was told by staff already. */
export function shouldNotify(status: string, n: NodeRecovery): boolean {
  if (!n.remedy || n.remedy === n.remedyNotified) return false;
  if (status === "approved") return true;
  return status === "leaving" && n.remedy !== "undo_leaving";
}

/** Whether the team's pages show the problem: the same rule, without the
 *  "already emailed" check. */
export function shouldShow(status: string, remedy: Remedy | null): boolean {
  return shouldNotify(status, { node: "", remedy, waitingAlerts: null, remedyNotified: null });
}
