import { randomBytes } from "node:crypto";

import { z } from "zod";

import { hashResetToken } from "../auth/reset-tokens";

// A SAR team's on-call email channel (plan 33 9.10, D9; G1, owner 2026-11-11).
// AvServ emails the confirmed address directly with each alert whose terms
// list `email` (sar_team_sync.md §5.5). The address is usually a shared
// dispatch inbox, not a portal user, so it's confirmed by a link sent to it
// that anyone reading the inbox can open; the link opens a page with a
// Confirm button, so a mail scanner that follows links can't confirm it.

/** How long a confirmation link stays valid. */
export const ONCALL_LINK_TTL_HOURS = 24;

/** Links a team may send per day (each is an email to an outside inbox). */
export const ONCALL_LINK_RATE_LIMIT = { limit: 5, windowSec: 24 * 60 * 60 };

export const oncallEmailSchema = z.object({
  address: z.string().trim().toLowerCase().max(320).email("Enter an email address, like dispatch@yourteam.org."),
});

export function generateOncallToken(now: Date = new Date()): { token: string; tokenHash: string; expires: Date } {
  const token = randomBytes(32).toString("hex");
  return { token, tokenHash: hashResetToken(token), expires: new Date(now.getTime() + ONCALL_LINK_TTL_HOURS * 60 * 60 * 1000) };
}

export function hashOncallToken(token: string): string {
  return hashResetToken(token);
}

// Team-facing words. [COUNSEL]: every team-facing string is counsel's to
// review before a real team (AvServ plan 41 §17.14). None describes when, how
// fast or whether anyone responds.
export const ONCALL_COPY = {
  heading: "On-call email",
  explain:
    "AvAI emails this address with each alert your terms send by email, as well as showing it on your Alerts page. Use an inbox your team reads, like a dispatch address.",
  gate: "Add and confirm an on-call email before you submit your terms.",
  sent: (address: string) => `We sent a confirmation link to ${address}. Open it from that inbox to confirm the address. It expires in ${ONCALL_LINK_TTL_HOURS} hours.`,
  pending: (address: string) => `Waiting for ${address} to be confirmed.`,
  current: (address: string) => `Alerts are emailed to ${address}.`,
  keepsCurrent: "Until a new address is confirmed, alerts keep going to the current one.",
  termsNote:
    "Terms you submit after confirming an address list email for each alert service, so users who add your team see that alerts reach you by email too.",
} as const;
